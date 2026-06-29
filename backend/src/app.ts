import express from "express";
import cors from "cors";
import { z } from "zod";
import { audit, all, checkDatabase, get, pool, run, transaction } from "./db.js";
import { hasRole, requireAuth, requireFirebase, requireRole } from "./auth.js";
import { haversineMeters } from "./domain.js";
import { geocodeAddress, GeocodingError } from "./geocoding.js";
import { createTwilioConversationAccess } from "./twilio-conversations.js";
import type { AuthedRequest, AuthUser } from "./types.js";

export const app = express();
app.use(cors({ origin: process.env.CORS_ORIGINS?.split(",") ?? true }));
app.use(express.json({ limit: "2mb" }));

const uuid = z.string().uuid();
const emailTemplateVariables = [
  {
    token: "{{volunteer.first_name}}",
    label: "Volunteer first name",
    description: "The recipient's first name",
    category: "Volunteer",
    example: "Daisy"
  },
  {
    token: "{{volunteer.full_name}}",
    label: "Volunteer full name",
    description: "The recipient's full name",
    category: "Volunteer",
    example: "Daisy Duck"
  },
  {
    token: "{{event.name}}",
    label: "Event name",
    description: "The scheduled event name",
    category: "Event",
    example: "Christmas Service"
  },
  {
    token: "{{event.date}}",
    label: "Event date",
    description: "The event's formatted date",
    category: "Event",
    example: "December 24, 2026"
  },
  {
    token: "{{event.start_time}}",
    label: "Event start time",
    description: "The event's local start time",
    category: "Event",
    example: "6:00 PM"
  },
  {
    token: "{{team.name}}",
    label: "Team name",
    description: "The volunteer's event team",
    category: "Team",
    example: "Food and Drinks"
  },
  {
    token: "{{campus.name}}",
    label: "Campus name",
    description: "The event campus",
    category: "Campus",
    example: "288 Campus"
  },
  {
    token: "{{leader.name}}",
    label: "Leader name",
    description: "The sending leader's name",
    category: "Leader",
    example: "Jordan Nelson"
  }
] as const;
const emailTemplateTokens = new Set(emailTemplateVariables.map((variable) => variable.token));
const emailTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(20_000),
  isActive: z.boolean().default(true)
});

function validateEmailTemplateVariables(subject: string, body: string) {
  const tokens = `${subject}\n${body}`.match(/{{[^{}]+}}/g) ?? [];
  const unsupported = [...new Set(tokens.filter((token) => !emailTemplateTokens.has(token as never)))];
  if (unsupported.length)
    throw new ApiError(
      `Unsupported email variable${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}`,
      422
    );
}
class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}
const route =
  (handler: (req: AuthedRequest, res: express.Response) => Promise<unknown>) =>
  async (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

app.get(
  "/api/health",
  route(async (_req, res) => {
    res.json({
      status: (await checkDatabase()) ? "ok" : "degraded",
      service: "VolunteerHub API",
      database: "postgresql",
      authentication: "firebase"
    });
  })
);

app.post(
  "/api/auth/register",
  requireFirebase,
  route(async (req, res) => {
    const body = z
      .object({
        firstName: z.string().min(1),
        middleName: z.string().trim().optional(),
        lastName: z.string().min(1),
        phone: z.string().min(7).optional(),
        birthDate: z.iso.date(),
        smsConsent: z.boolean().default(false)
      })
      .parse(req.body);
    const existing = await get("select id from volunteerhub.app_users where auth_uid=$1", [req.firebase!.uid]);
    if (existing) return void res.status(409).json({ error: "VolunteerHub profile already exists" });
    const result = await transaction(async (client) => {
      const user = (
        await client.query<{ id: string }>(
          `insert into volunteerhub.app_users(auth_uid, email, phone, display_name, middle_name)
       values ($1, $2, $3, $4, $5) returning id`,
          [
            req.firebase!.uid,
            req.firebase!.email!.toLowerCase(),
            body.phone ?? null,
            [body.firstName, body.middleName, body.lastName].filter(Boolean).join(" "),
            body.middleName || null
          ]
        )
      ).rows[0]!;
      await client.query("insert into app_user_roles(user_id, role_code) values($1, 'VOLUNTEER')", [user.id]);
      const volunteer = (
        await client.query<{ id: string }>(
          `insert into volunteer_profiles(app_user_id, first_name, middle_name, last_name, birth_date, application_status, application_submitted_at)
       values ($1, $2, $3, $4, $5, 'SUBMITTED', now()) returning id`,
          [user.id, body.firstName, body.middleName || null, body.lastName, body.birthDate]
        )
      ).rows[0]!;
      await client.query(`insert into notification_preferences(volunteer_id, sms_enabled) values ($1, $2)`, [
        volunteer.id,
        body.smsConsent
      ]);
      if (body.smsConsent) {
        await client.query(
          `insert into consents(volunteer_id, consent_type, version, granted) values ($1, 'SMS', '1', true)`,
          [volunteer.id]
        );
      }
      return { userId: user.id, volunteerId: volunteer.id };
    });
    await audit(result.userId, "USER_REGISTERED", "auth", result.userId, {
      email: req.firebase!.email?.toLowerCase()
    });
    await audit(result.userId, "APPLICATION_SUBMITTED", "volunteer", result.volunteerId);
    res.status(201).json({ message: "Application submitted for review" });
  })
);

app.post(
  "/api/auth/login",
  requireAuth,
  route(async (req, res) => {
    await audit(req.user!.id, "USER_LOGIN", "auth", req.user!.id, {
      email: req.user!.email,
      roles: req.user!.roles
    });
    res.json({ message: "Login recorded" });
  })
);

app.get(
  "/api/me",
  requireAuth,
  route(async (req, res) => {
    const profile = await get(
      `select u.id, u.email, u.phone,
      coalesce(nullif(u.display_name,''),nullif(concat_ws(' ',v.first_name,v.middle_name,v.last_name),''),u.email) display_name,
      coalesce(
        (select string_agg(c.name, ', ' order by uhc.is_primary desc, c.name)
         from user_home_campuses uhc join campuses c on c.id=uhc.campus_id
         where uhc.user_id=u.id),
        hc.name,
        (select name from campuses where is_active order by created_at,id limit 1),
        'Campus not assigned'
      ) home_campus_name,
      coalesce(
        (select array_agg(uhc.campus_id order by uhc.is_primary desc, c.name)
         from user_home_campuses uhc join campuses c on c.id=uhc.campus_id
         where uhc.user_id=u.id),
        case when u.home_campus_id is null then '{}'::uuid[] else array[u.home_campus_id] end
      ) home_campus_ids,
      coalesce(
        (select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by uhc.is_primary desc, c.name)
         from user_home_campuses uhc join campuses c on c.id=uhc.campus_id
         where uhc.user_id=u.id),
        '[]'::jsonb
      ) home_campuses,
      coalesce(
        (select array_agg(umm.ministry_id order by m.name)
         from user_ministry_memberships umm join ministries m on m.id=umm.ministry_id
         where umm.user_id=u.id),
        '{}'::uuid[]
      ) ministry_membership_ids,
      coalesce(
        (select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name)
         from user_ministry_memberships umm join ministries m on m.id=umm.ministry_id
         where umm.user_id=u.id),
        '[]'::jsonb
      ) ministry_memberships,
      (select coalesce(array_agg(aur.role_code order by aur.role_code), '{}') from app_user_roles aur where aur.user_id=u.id) roles,
      u.status, v.id volunteer_id, v.first_name, v.middle_name, v.last_name,
      v.birth_date, v.profile_photo_path profile_photo_url, v.application_status,
      v.emergency_contact_name, v.emergency_contact_phone,
      np.sms_enabled sms_consent, np.email_enabled email_opt_in, np.push_enabled push_opt_in
     from app_users u left join volunteer_profiles v on v.app_user_id=u.id
     left join campuses hc on hc.id=u.home_campus_id
     left join notification_preferences np on np.volunteer_id=v.id where u.id=$1`,
      [req.user!.id]
    );
    const household = req.user!.volunteerId
      ? await all(
          `select vp.id, vp.first_name, vp.middle_name, vp.last_name, vp.birth_date, vp.application_status,
          hm.relationship, hm.is_guardian_managed guardian_managed
     from household_members mine join household_members hm on hm.household_id=mine.household_id
     join volunteer_profiles vp on vp.id=hm.volunteer_id where mine.volunteer_id=$1`,
          [req.user!.volunteerId]
        )
      : [];
    res.json({ ...profile, ministry_ids: req.user!.ministryIds, household });
  })
);

app.patch(
  "/api/me",
  requireAuth,
  route(async (req, res) => {
    const optionalText = (max = 300) =>
      z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
        z.string().trim().max(max).optional()
      );
    const body = z
      .object({
        displayName: optionalText(200),
        firstName: optionalText(100),
        middleName: z.string().trim().optional(),
        lastName: optionalText(100),
        birthDate: z.preprocess(
          (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
          z.coerce.date().optional()
        ),
        phone: optionalText(40),
        emergencyContactName: optionalText(200),
        emergencyContactPhone: optionalText(40),
        profilePhotoPath: z.string().nullable().optional(),
        smsConsent: z.boolean().optional(),
        emailOptIn: z.boolean().optional(),
        pushOptIn: z.boolean().optional(),
        homeCampusIds: z.array(uuid).optional(),
        ministryMembershipIds: z.array(uuid).optional()
      })
      .parse(req.body);
    await transaction(async (client) => {
      if (body.homeCampusIds !== undefined) {
        const homeCampusIds = [...new Set(body.homeCampusIds)];
        if (homeCampusIds.length) {
          const campusResult = await client.query<{ count: number }>(
            "select count(*)::int count from campuses where id=any($1::uuid[]) and is_active",
            [homeCampusIds]
          );
          if (campusResult.rows[0]?.count !== homeCampusIds.length)
            throw new ApiError("One or more selected home campuses are invalid or inactive", 422);
        }
        await client.query("delete from user_home_campuses where user_id=$1", [req.user!.id]);
        for (const [index, campusId] of homeCampusIds.entries()) {
          await client.query("insert into user_home_campuses(user_id, campus_id, is_primary) values($1,$2,$3)", [
            req.user!.id,
            campusId,
            index === 0
          ]);
        }
        await client.query("update app_users set home_campus_id=$1 where id=$2", [
          homeCampusIds[0] ?? null,
          req.user!.id
        ]);
      }
      if (body.ministryMembershipIds !== undefined) {
        const ministryMembershipIds = [...new Set(body.ministryMembershipIds)];
        if (ministryMembershipIds.length) {
          const ministryResult = await client.query<{ count: number }>(
            "select count(*)::int count from ministries where id=any($1::uuid[]) and is_active",
            [ministryMembershipIds]
          );
          if (ministryResult.rows[0]?.count !== ministryMembershipIds.length)
            throw new ApiError("One or more selected ministries are invalid or inactive", 422);
        }
        await client.query("delete from user_ministry_memberships where user_id=$1", [req.user!.id]);
        if (ministryMembershipIds.length) {
          await client.query(
            `insert into user_ministry_memberships(user_id, ministry_id)
             select $1, unnest($2::uuid[])`,
            [req.user!.id, ministryMembershipIds]
          );
        }
      }
      if (req.user!.volunteerId) {
        await client.query(
          `update app_users u set
           phone=coalesce($1,u.phone),
           middle_name=case when $2 then $3 else u.middle_name end,
           display_name=case when $4 then concat_ws(' ',coalesce($5,v.first_name),case when $2 then $3 else v.middle_name end,coalesce($6,v.last_name)) else u.display_name end
           from volunteer_profiles v where v.id=$7 and u.id=$8`,
          [
            body.phone ?? null,
            body.middleName !== undefined,
            body.middleName || null,
            body.firstName !== undefined || body.middleName !== undefined || body.lastName !== undefined,
            body.firstName ?? null,
            body.lastName ?? null,
            req.user!.volunteerId,
            req.user!.id
          ]
        );
        await client.query(
          `update volunteer_profiles set first_name=coalesce($1,first_name),
         middle_name=case when $2 then $3 else middle_name end,last_name=coalesce($4,last_name),
         birth_date=coalesce($5,birth_date),emergency_contact_name=coalesce($6,emergency_contact_name),
         emergency_contact_phone=coalesce($7,emergency_contact_phone),profile_photo_path=coalesce($8,profile_photo_path)
         where id=$9`,
          [
            body.firstName ?? null,
            body.middleName !== undefined,
            body.middleName || null,
            body.lastName ?? null,
            body.birthDate ?? null,
            body.emergencyContactName ?? null,
            body.emergencyContactPhone ?? null,
            body.profilePhotoPath ?? null,
            req.user!.volunteerId
          ]
        );
        if (body.middleName !== undefined) {
          await client.query("update household_members set middle_name=$1 where volunteer_id=$2", [
            body.middleName || null,
            req.user!.volunteerId
          ]);
        }
        await client.query(
          `insert into notification_preferences(volunteer_id, sms_enabled, email_enabled, push_enabled)
         values ($1, coalesce($2, false), coalesce($3, true), coalesce($4, true))
         on conflict(volunteer_id) do update set
         sms_enabled=coalesce($2, notification_preferences.sms_enabled),
         email_enabled=coalesce($3, notification_preferences.email_enabled),
         push_enabled=coalesce($4, notification_preferences.push_enabled)`,
          [req.user!.volunteerId, body.smsConsent ?? null, body.emailOptIn ?? null, body.pushOptIn ?? null]
        );
      } else {
        const displayName =
          body.displayName ??
          [body.firstName, body.middleName, body.lastName]
            .map((part) => part?.trim())
            .filter(Boolean)
            .join(" ");
        await client.query(
          `update app_users set
           phone=coalesce($1, phone),
           middle_name=case when $2 then $3 else middle_name end,
           display_name=case when $4::text is not null then $4 else display_name end
           where id=$5`,
          [
            body.phone ?? null,
            body.middleName !== undefined,
            body.middleName || null,
            displayName || null,
            req.user!.id
          ]
        );
      }
    });
    await audit(
      req.user!.id,
      "PROFILE_UPDATED",
      req.user!.volunteerId ? "volunteer" : "app_user",
      req.user!.volunteerId ?? req.user!.id
    );
    res.json({ message: "Profile updated" });
  })
);

app.post(
  "/api/household/dependents",
  requireAuth,
  route(async (req, res) => {
    if (!req.user!.volunteerId) return void res.status(400).json({ error: "No volunteer profile" });
    const body = z
      .object({
        firstName: z.string().trim().min(1),
        middleName: z.string().trim().optional(),
        lastName: z.string().trim().min(1),
        birthDate: z.coerce.date().max(new Date()),
        relationship: z.string().trim().min(1).max(80),
        dependentParticipationConsent: z.literal(true)
      })
      .parse(req.body);
    const result = await transaction(async (client) => {
      let household = (
        await client.query<{ id: string }>(
          `select h.id from households h join household_members hm on hm.household_id=h.id
           where hm.volunteer_id=$1`,
          [req.user!.volunteerId]
        )
      ).rows[0];
      if (!household) {
        household = (
          await client.query<{ id: string }>(
            `insert into households(name,created_by)
             select coalesce(nullif(last_name,''),'Volunteer') || ' Household',$2
             from volunteer_profiles where id=$1 returning id`,
            [req.user!.volunteerId, req.user!.id]
          )
        ).rows[0]!;
        await client.query(
          `insert into household_members(household_id,volunteer_id,middle_name,relationship,is_guardian_managed)
           select $1,$2,middle_name,'Self',false from volunteer_profiles where id=$2`,
          [household.id, req.user!.volunteerId]
        );
      }
      const dependent = (
        await client.query<{ id: string }>(
          `insert into volunteer_profiles(first_name,middle_name,last_name,birth_date,application_status,application_submitted_at)
           values($1,$2,$3,$4,'SUBMITTED',now()) returning id`,
          [body.firstName, body.middleName || null, body.lastName, body.birthDate]
        )
      ).rows[0]!;
      await client.query(
        `insert into household_members(household_id,volunteer_id,middle_name,relationship,is_guardian_managed)
         values($1,$2,$3,$4,true)`,
        [household.id, dependent.id, body.middleName || null, body.relationship]
      );
      await client.query(
        `insert into guardian_authorizations(guardian_volunteer_id,dependent_volunteer_id,authorized_by,status,authorized_at)
         values($1,$2,$3,'ACTIVE',now())`,
        [req.user!.volunteerId, dependent.id, req.user!.id]
      );
      await client.query(
        `insert into consents(volunteer_id,consent_type,version,granted,guardian_volunteer_id)
         values($1,'DEPENDENT_PARTICIPATION','1',true,$2)`,
        [dependent.id, req.user!.volunteerId]
      );
      return dependent;
    });
    await audit(req.user!.id, "DEPENDENT_CREATED", "volunteer", result.id, { relationship: body.relationship });
    res.status(201).json({ id: result.id, applicationStatus: "SUBMITTED" });
  })
);

app.get(
  "/api/dashboard",
  requireAuth,
  route(async (req, res) => {
    if (hasRole(req.user!, "EVENT_LEADER") && !hasRole(req.user!, "ADMIN")) {
      const result = await get<{ upcoming_events: number; pending_assignments: number }>(
        `select count(distinct e.id)::int upcoming_events,
       count(a.id) filter(where a.status='REQUESTED')::int pending_assignments
       from events e left join event_groups eg on eg.event_id=e.id
       left join assignments a on a.event_group_id=eg.id
       where e.starts_at>now() and ($1::uuid=any(e.event_leader_user_ids) or $1::uuid=any(eg.leader_user_ids))`,
        [req.user!.id]
      );
      return void res.json({
        upcomingEvents: result?.upcoming_events ?? 0,
        pendingAssignments: result?.pending_assignments ?? 0,
        pendingApplications: 0,
        expiringCompliance: 0
      });
    }
    const metrics = await get<{
      upcoming_events: number;
      pending_applications: number;
      pending_assignments: number;
      expiring_requirements: number;
    }>("select * from dashboard_metrics");
    res.json({
      upcomingEvents: metrics?.upcoming_events ?? 0,
      pendingApplications: hasRole(req.user!, "ADMIN") ? (metrics?.pending_applications ?? 0) : 0,
      pendingAssignments: metrics?.pending_assignments ?? 0,
      expiringCompliance: hasRole(req.user!, "ADMIN") ? (metrics?.expiring_requirements ?? 0) : 0
    });
  })
);

app.get(
  "/api/my-commitments",
  requireAuth,
  route(async (req, res) => {
    res.json(
      await all(
        `select a.id assignment_id,a.status assignment_status,at.status attendance_status,
         eg.id event_group_id,eg.name event_group_name,eg.description event_group_description,
         eg.self_checkin_enabled,e.id event_id,e.name event_name,e.starts_at,e.ends_at,
         e.address,e.latitude,e.longitude,c.name campus_name,
         concat_ws(', ', c.address_line_1, nullif(c.address_line_2, ''), c.city, c.region || ' ' || c.postal_code) campus_address,
         ($2::uuid=any(eg.leader_user_ids)) is_team_leader
         from assignments a join event_groups eg on eg.id=a.event_group_id
         join events e on e.id=eg.event_id join campuses c on c.id=e.campus_id
         left join attendance at on at.assignment_id=a.id
         where $1::uuid is not null and a.volunteer_id=$1
           and a.status in ('REQUESTED','WAITLISTED','CONFIRMED','COMPLETED')
         union all
         select null::uuid assignment_id,'TEAM_LEADER' assignment_status,null::text attendance_status,
         eg.id event_group_id,eg.name event_group_name,eg.description event_group_description,
         eg.self_checkin_enabled,e.id event_id,e.name event_name,e.starts_at,e.ends_at,
         e.address,e.latitude,e.longitude,c.name campus_name,
         concat_ws(', ', c.address_line_1, nullif(c.address_line_2, ''), c.city, c.region || ' ' || c.postal_code) campus_address,
         true is_team_leader
         from event_groups eg join events e on e.id=eg.event_id join campuses c on c.id=e.campus_id
         where $2::uuid=any(eg.leader_user_ids) and eg.is_active
           and not exists (
             select 1 from assignments a where a.event_group_id=eg.id and $1::uuid is not null
             and a.volunteer_id=$1 and a.status in ('REQUESTED','WAITLISTED','CONFIRMED','COMPLETED')
           )
         order by starts_at,event_group_name`,
        [req.user!.volunteerId ?? null, req.user!.id]
      )
    );
  })
);

app.get(
  "/api/catalog",
  requireAuth,
  route(async (_req, res) => {
    res.json({
      campuses: await all(
        `select id, name,
         concat_ws(', ', address_line_1, nullif(address_line_2, ''), city, region || ' ' || postal_code) address,
         latitude, longitude
         from campuses where is_active order by name`
      ),
      ministries: await all(
        "select id, name, description, is_active, created_at, updated_at from ministries where is_active order by name"
      ),
      roles: await all(
        "select mr.*, m.name ministry_name from ministry_roles mr join ministries m on m.id=mr.ministry_id where mr.is_active order by m.name, mr.name"
      )
    });
  })
);

async function canManageMinistryMembership(user: AuthUser, ministryId: string, campusId?: string) {
  if (hasRole(user, "ADMIN")) return true;
  const manager = await get(
    `select 1
     where exists (
       select 1 from leader_ministries lm
       where lm.user_id=$1 and lm.ministry_id=$2
     )
     or exists (
       select 1 from ministry_campus_leads mcl
       where mcl.lead_user_id=$1 and mcl.ministry_id=$2
         and ($3::uuid is null or mcl.campus_id=$3)
     )`,
    [user.id, ministryId, campusId ?? null]
  );
  return Boolean(manager);
}

app.get(
  "/api/tools/ministry-membership/my-requests",
  requireAuth,
  route(async (req, res) => {
    res.json(
      await all(
        `select r.id, r.ministry_id, m.name ministry_name, r.campus_id, c.name campus_name,
         r.status, r.requested_at, r.decided_at, r.decision_reason,
         coalesce(decider.display_name, decider.email) decided_by_name
         from ministry_membership_requests r
         join ministries m on m.id=r.ministry_id
         join campuses c on c.id=r.campus_id
         left join app_users decider on decider.id=r.decided_by
         where r.user_id=$1
         order by r.requested_at desc`,
        [req.user!.id]
      )
    );
  })
);

app.post(
  "/api/tools/ministry-membership/requests",
  requireAuth,
  route(async (req, res) => {
    if (!req.user!.volunteerId) throw new ApiError("Only volunteer profiles can request ministry membership", 403);
    const body = z.object({ ministryId: uuid, campusId: uuid }).parse(req.body);
    const target = await get<{ ministry_name: string; campus_name: string }>(
      `select m.name ministry_name, c.name campus_name
       from ministries m cross join campuses c
       where m.id=$1 and c.id=$2 and m.is_active and c.is_active`,
      [body.ministryId, body.campusId]
    );
    if (!target) throw new ApiError("Select an active ministry and campus", 422);
    const existingRequest = await get(
      `select 1 from ministry_membership_requests
       where user_id=$1 and ministry_id=$2 and campus_id=$3`,
      [req.user!.id, body.ministryId, body.campusId]
    );
    if (existingRequest) throw new ApiError("You already submitted a request for this ministry at this campus", 409);
    const request = await get<{ id: string }>(
      `insert into ministry_membership_requests(user_id, volunteer_id, ministry_id, campus_id)
       values($1,$2,$3,$4) returning id`,
      [req.user!.id, req.user!.volunteerId, body.ministryId, body.campusId]
    );
    await audit(req.user!.id, "MINISTRY_MEMBERSHIP_REQUESTED", "ministry_membership_request", request!.id, {
      ministryId: body.ministryId,
      campusId: body.campusId
    });
    res.status(201).json({ id: request!.id });
  })
);

app.get(
  "/api/tools/ministry-membership/requests",
  requireAuth,
  route(async (req, res) => {
    const isAdmin = hasRole(req.user!, "ADMIN");
    res.json(
      await all(
        `select r.id, r.user_id, r.volunteer_id, r.ministry_id, m.name ministry_name,
         r.campus_id, c.name campus_name, r.status, r.requested_at,
         coalesce(u.display_name, u.email) user_name, u.email user_email,
         concat_ws(' ', vp.first_name, nullif(vp.middle_name, ''), vp.last_name) volunteer_name
         from ministry_membership_requests r
         join app_users u on u.id=r.user_id
         left join volunteer_profiles vp on vp.id=r.volunteer_id
         join ministries m on m.id=r.ministry_id
         join campuses c on c.id=r.campus_id
         where r.status='PENDING'
           and (
             $1::boolean
             or exists (
               select 1 from leader_ministries lm
               where lm.user_id=$2 and lm.ministry_id=r.ministry_id
             )
             or exists (
               select 1 from ministry_campus_leads mcl
               where mcl.lead_user_id=$2 and mcl.ministry_id=r.ministry_id and mcl.campus_id=r.campus_id
             )
           )
         order by r.requested_at, m.name, c.name`,
        [isAdmin, req.user!.id]
      )
    );
  })
);

app.get(
  "/api/tools/ministry-membership/scope",
  requireAuth,
  route(async (req, res) => {
    const isAdmin = hasRole(req.user!, "ADMIN");
    const ministries = await all<{ id: string; name: string }>(
      `select distinct m.id, m.name
       from ministries m
       left join leader_ministries lm on lm.ministry_id=m.id
       left join ministry_campus_leads mcl on mcl.ministry_id=m.id
       where m.is_active
         and ($1::boolean or lm.user_id=$2 or mcl.lead_user_id=$2)
       order by m.name`,
      [isAdmin, req.user!.id]
    );
    const campuses = await all<{ id: string; name: string }>(
      `select id, name
       from campuses
       where is_active
       order by name`
    );
    const ministryHeads = await all<{ ministry_id: string }>(
      `select ministry_id
       from leader_ministries
       where user_id=$1`,
      [req.user!.id]
    );
    const campusLeads = await all<{ ministry_id: string; campus_id: string }>(
      `select ministry_id, campus_id
       from ministry_campus_leads
       where lead_user_id=$1`,
      [req.user!.id]
    );
    res.json({
      isAdmin,
      ministries,
      campuses,
      ministryHeadIds: ministryHeads.map((row) => row.ministry_id),
      campusLeadScopes: campusLeads
    });
  })
);

app.patch(
  "/api/tools/ministry-membership/requests/:requestId",
  requireAuth,
  route(async (req, res) => {
    const requestId = uuid.parse(req.params.requestId);
    const body = z
      .object({
        decision: z.enum(["APPROVED", "DENIED"]),
        reason: z.string().trim().max(500).optional()
      })
      .parse(req.body);
    const request = await transaction(async (client) => {
      const current = (
        await client.query<{
          id: string;
          user_id: string;
          ministry_id: string;
          campus_id: string;
          status: string;
        }>(
          "select id, user_id, ministry_id, campus_id, status from ministry_membership_requests where id=$1 for update",
          [requestId]
        )
      ).rows[0];
      if (!current) throw new ApiError("Membership request not found", 404);
      if (current.status !== "PENDING") throw new ApiError("This membership request has already been decided", 409);
      if (!(await canManageMinistryMembership(req.user!, current.ministry_id, current.campus_id)))
        throw new ApiError("Only the Ministry Head or campus ministry lead can decide this request", 403);
      await client.query(
        `update ministry_membership_requests
         set status=$2, decided_by=$3, decided_at=now(), decision_reason=$4
         where id=$1`,
        [requestId, body.decision, req.user!.id, body.reason ?? null]
      );
      if (body.decision === "APPROVED") {
        await client.query(
          `insert into user_ministry_memberships(user_id, ministry_id, campus_id, assigned_at)
           values($1,$2,$3,now())
           on conflict (user_id, ministry_id) do nothing`,
          [current.user_id, current.ministry_id, current.campus_id]
        );
      }
      return current;
    });
    await audit(req.user!.id, `MINISTRY_MEMBERSHIP_${body.decision}`, "ministry_membership_request", requestId, {
      userId: request.user_id,
      ministryId: request.ministry_id,
      campusId: request.campus_id,
      reason: body.reason
    });
    res.json({ status: body.decision });
  })
);

app.get(
  "/api/tools/ministry-membership/members",
  requireAuth,
  route(async (req, res) => {
    const campusId =
      typeof req.query.campusId === "string" && req.query.campusId ? uuid.parse(req.query.campusId) : null;
    const ministryId =
      typeof req.query.ministryId === "string" && req.query.ministryId ? uuid.parse(req.query.ministryId) : null;
    const isAdmin = hasRole(req.user!, "ADMIN");
    res.json(
      await all(
        `select r.user_id, r.ministry_id, m.name ministry_name, r.campus_id, c.name campus_name,
         coalesce(r.decided_at, r.requested_at) assigned_at, coalesce(u.display_name, u.email) user_name, u.email user_email,
         concat_ws(' ', vp.first_name, nullif(vp.middle_name, ''), vp.last_name) volunteer_name
         from ministry_membership_requests r
         join app_users u on u.id=r.user_id
         left join volunteer_profiles vp on vp.app_user_id=u.id
         join ministries m on m.id=r.ministry_id
         join campuses c on c.id=r.campus_id
         where r.status='APPROVED'
           and ($3::uuid is null or r.campus_id=$3)
           and ($4::uuid is null or r.ministry_id=$4)
           and (
             $1::boolean
             or exists (
               select 1 from leader_ministries lm
               where lm.user_id=$2 and lm.ministry_id=r.ministry_id
             )
             or exists (
               select 1 from ministry_campus_leads mcl
               where mcl.lead_user_id=$2 and mcl.ministry_id=r.ministry_id and mcl.campus_id=r.campus_id
             )
           )
         order by m.name, c.name nulls last, coalesce(u.display_name, u.email)`,
        [isAdmin, req.user!.id, campusId, ministryId]
      )
    );
  })
);

app.get(
  "/api/tools/email-template-variables",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (_req, res) => res.json(emailTemplateVariables))
);

app.get(
  "/api/tools/email-templates",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER", "TEAM_LEADER"),
  route(async (req, res) => {
    const isAdmin = hasRole(req.user!, "ADMIN");
    const canManageTemplates = isAdmin || hasRole(req.user!, "EVENT_LEADER");
    const rows = await all<Record<string, unknown>>(
      `select et.*, coalesce(u.display_name, u.email) creator_name
       from email_templates et
       join app_users u on u.id=et.created_by
       where $1::boolean
          or et.created_by=$2
          or ($3::boolean and et.is_active)
       order by et.is_active desc, et.updated_at desc, et.name`,
      [isAdmin, req.user!.id, !canManageTemplates]
    );
    res.json(
      rows.map((row) => ({
        ...row,
        can_edit: isAdmin || (hasRole(req.user!, "EVENT_LEADER") && row.created_by === req.user!.id)
      }))
    );
  })
);

app.post(
  "/api/tools/email-templates",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const body = emailTemplateSchema.parse(req.body);
    validateEmailTemplateVariables(body.subject, body.body);
    const template = await get<Record<string, unknown>>(
      `insert into email_templates(name, subject, body, created_by, is_active)
       values($1,$2,$3,$4,$5) returning *`,
      [body.name, body.subject, body.body, req.user!.id, body.isActive]
    );
    await audit(req.user!.id, "EMAIL_TEMPLATE_CREATED", "email_template", String(template!.id));
    res.status(201).json(template);
  })
);

app.patch(
  "/api/tools/email-templates/:id",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = emailTemplateSchema.parse(req.body);
    validateEmailTemplateVariables(body.subject, body.body);
    const existing = await get<{ created_by: string }>("select created_by from email_templates where id=$1", [id]);
    if (!existing) throw new ApiError("Email template not found", 404);
    const isAdmin = hasRole(req.user!, "ADMIN");
    if (!isAdmin && existing.created_by !== req.user!.id)
      throw new ApiError("Only the template creator can edit this template", 403);
    const template = await get<Record<string, unknown>>(
      `update email_templates set name=$2, subject=$3, body=$4, is_active=$5
       where id=$1 returning *`,
      [id, body.name, body.subject, body.body, body.isActive]
    );
    await audit(req.user!.id, "EMAIL_TEMPLATE_UPDATED", "email_template", id);
    res.json(template);
  })
);

app.get(
  "/api/administration/event-leaders",
  requireAuth,
  requireRole("ADMIN"),
  route(async (_req, res) => {
    res.json(
      await all(
        `select u.id, u.display_name, u.email, array_agg(aur.role_code order by aur.role_code) roles
         from app_users u join app_user_roles aur on aur.user_id=u.id
         where u.status='ACTIVE' and aur.role_code in ('ADMIN', 'EVENT_LEADER')
         group by u.id
         order by coalesce(display_name, email), email`
      )
    );
  })
);

app.get(
  "/api/administration/team-leaders",
  requireAuth,
  requireRole("ADMIN"),
  route(async (_req, res) => {
    res.json(
      await all(
        `select u.id, u.display_name, u.email, array_agg(aur.role_code order by aur.role_code) roles
         from app_users u join app_user_roles aur on aur.user_id=u.id
         where u.status='ACTIVE' and aur.role_code in ('ADMIN', 'EVENT_LEADER', 'TEAM_LEADER')
         group by u.id
         order by coalesce(display_name, email), email`
      )
    );
  })
);

app.get(
  "/api/administration/ministry-leader-candidates",
  requireAuth,
  route(async (req, res) => {
    const isMinistryHead = req.user!.ministryIds.length > 0;
    if (!hasRole(req.user!, "ADMIN") && !isMinistryHead)
      throw new ApiError("Only an administrator or Ministry Head can view ministry leader candidates", 403);
    const ministryHeads = await all(
      `select u.id, u.display_name, u.email, array_agg(aur.role_code order by aur.role_code) roles
       from app_users u join app_user_roles aur on aur.user_id=u.id
       where u.status='ACTIVE' and aur.role_code='MINISTRY_HEAD'
       group by u.id
       order by coalesce(display_name, email), email`
    );
    const campusLeads = await all(
      `select u.id, u.display_name, u.email, array_agg(aur.role_code order by aur.role_code) roles
         from app_users u join app_user_roles aur on aur.user_id=u.id
         where u.status='ACTIVE' and aur.role_code in ('ADMIN', 'EVENT_LEADER', 'TEAM_LEADER', 'MINISTRY_HEAD')
         group by u.id
         order by coalesce(display_name, email), email`
    );
    res.json({ ministryHeads, campusLeads });
  })
);

const systemRoleInput = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().trim().min(2),
  description: z.string().trim().nullable().optional(),
  isActive: z.boolean().default(true)
});

app.get(
  "/api/administration/system-roles",
  requireAuth,
  requireRole("ADMIN"),
  route(async (_req, res) => {
    res.json(
      await all(
        `select r.*, count(aur.user_id)::int assignment_count
         from roles r left join app_user_roles aur on aur.role_code=r.code
         group by r.code order by r.is_active desc, r.name`
      )
    );
  })
);

app.post(
  "/api/administration/system-roles",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const body = systemRoleInput.parse(req.body);
    const role = await get<{ code: string }>(
      `insert into roles(code,name,description,is_active) values($1,$2,$3,$4) returning code`,
      [body.code, body.name, body.description || null, body.isActive]
    );
    await audit(req.user!.id, "SYSTEM_ROLE_CREATED", "role", undefined, body);
    res.status(201).json({ code: role!.code });
  })
);

app.patch(
  "/api/administration/system-roles/:roleCode",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const roleCode = z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .parse(req.params.roleCode);
    const body = systemRoleInput.parse({ ...req.body, code: roleCode });
    const role = await get<{ code: string }>(
      "update roles set name=$1,description=$2,is_active=$3 where code=$4 returning code",
      [body.name, body.description || null, body.isActive, roleCode]
    );
    if (!role) return void res.status(404).json({ error: "System role not found" });
    await audit(req.user!.id, "SYSTEM_ROLE_UPDATED", "role", undefined, body);
    res.json({ message: "System role updated" });
  })
);

app.get(
  "/api/administration/role-assignments",
  requireAuth,
  requireRole("ADMIN"),
  route(async (_req, res) => {
    res.json(
      await all(
        `select u.id, u.display_name, u.email, u.status,
         coalesce(array_agg(aur.role_code order by aur.role_code) filter (where aur.role_code is not null), '{}') roles
         from app_users u left join app_user_roles aur on aur.user_id=u.id
         group by u.id order by coalesce(u.display_name,u.email),u.email`
      )
    );
  })
);

app.put(
  "/api/administration/role-assignments/:userId",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const userId = uuid.parse(req.params.userId);
    const body = z.object({ roles: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(1) }).parse(req.body);
    const uniqueRoles = [...new Set(body.roles)];
    const valid = await get<{ count: number }>(
      "select count(*)::int count from roles where code=any($1::text[]) and is_active",
      [uniqueRoles]
    );
    if (valid?.count !== uniqueRoles.length)
      return void res.status(422).json({ error: "One or more selected roles are invalid or inactive" });
    const user = await get("select id from app_users where id=$1", [userId]);
    if (!user) return void res.status(404).json({ error: "User not found" });
    await transaction(async (client) => {
      await client.query("delete from app_user_roles where user_id=$1", [userId]);
      await client.query(
        `insert into app_user_roles(user_id,role_code,assigned_by)
         select $1,unnest($2::text[]),$3`,
        [userId, uniqueRoles, req.user!.id]
      );
    });
    await audit(req.user!.id, "USER_ROLES_UPDATED", "app_user", userId, { roles: uniqueRoles });
    res.json({ message: "Role assignments updated" });
  })
);

const campusInput = z.object({
  name: z.string().trim().min(2),
  addressLine1: z.string().trim().min(1),
  addressLine2: z.string().trim().nullable().optional(),
  city: z.string().trim().min(1),
  region: z.string().trim().min(1),
  postalCode: z.string().trim().min(1),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  timezone: z.string().trim().min(1),
  isActive: z.boolean().default(true)
});

async function campusCoordinates(body: z.infer<typeof campusInput>) {
  if (
    body.latitude !== null &&
    body.latitude !== undefined &&
    body.longitude !== null &&
    body.longitude !== undefined
  ) {
    return { latitude: body.latitude, longitude: body.longitude };
  }
  return geocodeAddress(body);
}

app.get(
  "/api/administration/campuses",
  requireAuth,
  requireRole("ADMIN"),
  route(async (_req, res) => {
    res.json(
      await all(
        `select id, name, address_line_1, address_line_2, city, region, postal_code, country_code,
        latitude, longitude, timezone, is_active, created_at, updated_at
        from campuses order by is_active desc, name`
      )
    );
  })
);

app.post(
  "/api/administration/campuses",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const body = campusInput.parse(req.body);
    const coordinates = await campusCoordinates(body);
    const campus = await get<{ id: string }>(
      `insert into campuses(name, address_line_1, address_line_2, city, region, postal_code, country_code,
      latitude, longitude, timezone, is_active)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        body.name,
        body.addressLine1,
        body.addressLine2 || null,
        body.city,
        body.region,
        body.postalCode,
        body.countryCode,
        coordinates.latitude,
        coordinates.longitude,
        body.timezone,
        body.isActive
      ]
    );
    await audit(req.user!.id, "CAMPUS_CREATED", "campus", campus!.id, { ...body, ...coordinates });
    res.status(201).json({ id: campus!.id, ...coordinates });
  })
);

app.patch(
  "/api/administration/campuses/:campusId",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const campusId = uuid.parse(req.params.campusId);
    const body = campusInput.parse(req.body);
    const coordinates = await campusCoordinates(body);
    const campus = await get<{ id: string }>(
      `update campuses set name=$1, address_line_1=$2, address_line_2=$3, city=$4, region=$5,
      postal_code=$6, country_code=$7, latitude=$8, longitude=$9, timezone=$10, is_active=$11
      where id=$12 returning id`,
      [
        body.name,
        body.addressLine1,
        body.addressLine2 || null,
        body.city,
        body.region,
        body.postalCode,
        body.countryCode,
        coordinates.latitude,
        coordinates.longitude,
        body.timezone,
        body.isActive,
        campusId
      ]
    );
    if (!campus) return void res.status(404).json({ error: "Campus not found" });
    await audit(req.user!.id, "CAMPUS_UPDATED", "campus", campus.id, { ...body, ...coordinates });
    res.json({ message: "Campus updated", ...coordinates });
  })
);

const ministryCampusLeadInput = z.object({
  campusId: uuid,
  leadUserId: uuid.nullish()
});
const ministryInput = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().nullable().optional(),
  ministryHeadUserId: uuid.nullish(),
  campusLeads: z.array(ministryCampusLeadInput).default([]),
  isActive: z.boolean().default(true)
});

app.get(
  "/api/administration/ministries",
  requireAuth,
  route(async (req, res) => {
    const isAdmin = hasRole(req.user!, "ADMIN");
    const isMinistryHead = req.user!.ministryIds.length > 0;
    if (!isAdmin && !isMinistryHead)
      throw new ApiError("Only an administrator or Ministry Head can view ministry assignments", 403);
    res.json(
      await all(
        `select m.id, m.name, m.description, m.is_active, m.created_at, m.updated_at,
        head.user_id ministry_head_user_id,
        coalesce(head_user.display_name, head_user.email) ministry_head_name,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'campus_id', c.id,
            'campus_name', c.name,
            'lead_user_id', mcl.lead_user_id,
            'lead_name', coalesce(lead_user.display_name, lead_user.email)
          ) order by c.name)
          from campuses c
          left join ministry_campus_leads mcl on mcl.ministry_id=m.id and mcl.campus_id=c.id
          left join app_users lead_user on lead_user.id=mcl.lead_user_id
          where c.is_active or mcl.lead_user_id is not null
        ), '[]'::jsonb) campus_leads
        from ministries m
        left join leader_ministries head on head.ministry_id=m.id
        left join app_users head_user on head_user.id=head.user_id
        where $1::boolean or m.id=any($2::uuid[])
        order by m.is_active desc, m.name`,
        [isAdmin, req.user!.ministryIds]
      )
    );
  })
);

app.post(
  "/api/administration/ministries",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const body = ministryInput.parse(req.body);
    const ministry = await transaction(async (client) => {
      if (body.ministryHeadUserId) {
        const ministryHeadResult = await client.query<{ count: number }>(
          `select count(distinct u.id)::int count
           from app_users u join app_user_roles aur on aur.user_id=u.id
           where u.id=$1 and u.status='ACTIVE' and aur.role_code='MINISTRY_HEAD'`,
          [body.ministryHeadUserId]
        );
        if (ministryHeadResult.rows[0]?.count !== 1)
          throw new ApiError("The selected Ministry Head must have the Ministry Head system role", 422);
      }
      const campusLeadIds = body.campusLeads.map((lead) => lead.leadUserId).filter(Boolean);
      if (campusLeadIds.length) {
        const leaderResult = await client.query<{ count: number }>(
          `select count(distinct u.id)::int count
           from app_users u join app_user_roles aur on aur.user_id=u.id
           where u.id=any($1::uuid[]) and u.status='ACTIVE'
             and aur.role_code in ('ADMIN','EVENT_LEADER','TEAM_LEADER','MINISTRY_HEAD')`,
          [[...new Set(campusLeadIds)]]
        );
        if (leaderResult.rows[0]?.count !== new Set(campusLeadIds).size)
          throw new ApiError("One or more selected campus leads are invalid or inactive", 422);
      }
      const campusIds = body.campusLeads.map((lead) => lead.campusId);
      if (campusIds.length) {
        const campusResult = await client.query<{ count: number }>(
          "select count(distinct id)::int count from campuses where id=any($1::uuid[])",
          [[...new Set(campusIds)]]
        );
        if (campusResult.rows[0]?.count !== new Set(campusIds).size)
          throw new ApiError("One or more selected campuses are invalid", 422);
      }
      const created = (
        await client.query<{ id: string }>(
          `insert into ministries(name, description, is_active) values($1,$2,$3) returning id`,
          [body.name, body.description || null, body.isActive]
        )
      ).rows[0]!;
      if (body.ministryHeadUserId) {
        await client.query("insert into leader_ministries(user_id,ministry_id,assigned_by) values($1,$2,$3)", [
          body.ministryHeadUserId,
          created.id,
          req.user!.id
        ]);
      }
      for (const lead of body.campusLeads) {
        if (!lead.leadUserId) continue;
        await client.query(
          `insert into ministry_campus_leads(ministry_id,campus_id,lead_user_id,assigned_by)
           values($1,$2,$3,$4)`,
          [created.id, lead.campusId, lead.leadUserId, req.user!.id]
        );
      }
      return created;
    });
    await audit(req.user!.id, "MINISTRY_CREATED", "ministry", ministry.id, body);
    res.status(201).json({ id: ministry.id });
  })
);

app.patch(
  "/api/administration/ministries/:ministryId",
  requireAuth,
  route(async (req, res) => {
    const ministryId = uuid.parse(req.params.ministryId);
    const body = ministryInput.parse(req.body);
    if (!hasRole(req.user!, "ADMIN")) {
      const canManage = await get("select 1 from leader_ministries where ministry_id=$1 and user_id=$2", [
        ministryId,
        req.user!.id
      ]);
      if (!canManage) throw new ApiError("Only an administrator or the Ministry Head can update this ministry", 403);
    }
    const ministry = await transaction(async (client) => {
      if (body.ministryHeadUserId) {
        const ministryHeadResult = await client.query<{ count: number }>(
          `select count(distinct u.id)::int count
           from app_users u join app_user_roles aur on aur.user_id=u.id
           where u.id=$1 and u.status='ACTIVE' and aur.role_code='MINISTRY_HEAD'`,
          [body.ministryHeadUserId]
        );
        if (ministryHeadResult.rows[0]?.count !== 1)
          throw new ApiError("The selected Ministry Head must have the Ministry Head system role", 422);
      }
      const campusLeadIds = body.campusLeads.map((lead) => lead.leadUserId).filter(Boolean);
      if (campusLeadIds.length) {
        const leaderResult = await client.query<{ count: number }>(
          `select count(distinct u.id)::int count
           from app_users u join app_user_roles aur on aur.user_id=u.id
           where u.id=any($1::uuid[]) and u.status='ACTIVE'
             and aur.role_code in ('ADMIN','EVENT_LEADER','TEAM_LEADER','MINISTRY_HEAD')`,
          [[...new Set(campusLeadIds)]]
        );
        if (leaderResult.rows[0]?.count !== new Set(campusLeadIds).size)
          throw new ApiError("One or more selected campus leads are invalid or inactive", 422);
      }
      const campusIds = body.campusLeads.map((lead) => lead.campusId);
      if (campusIds.length) {
        const campusResult = await client.query<{ count: number }>(
          "select count(distinct id)::int count from campuses where id=any($1::uuid[])",
          [[...new Set(campusIds)]]
        );
        if (campusResult.rows[0]?.count !== new Set(campusIds).size)
          throw new ApiError("One or more selected campuses are invalid", 422);
      }
      const updated = (
        await client.query<{ id: string }>(
          `update ministries set name=$1, description=$2, is_active=$3 where id=$4 returning id`,
          [body.name, body.description || null, body.isActive, ministryId]
        )
      ).rows[0];
      if (!updated) return undefined;
      await client.query("delete from leader_ministries where ministry_id=$1", [ministryId]);
      if (body.ministryHeadUserId) {
        await client.query("insert into leader_ministries(user_id,ministry_id,assigned_by) values($1,$2,$3)", [
          body.ministryHeadUserId,
          ministryId,
          req.user!.id
        ]);
      }
      await client.query("delete from ministry_campus_leads where ministry_id=$1", [ministryId]);
      for (const lead of body.campusLeads) {
        if (!lead.leadUserId) continue;
        await client.query(
          `insert into ministry_campus_leads(ministry_id,campus_id,lead_user_id,assigned_by)
           values($1,$2,$3,$4)`,
          [ministryId, lead.campusId, lead.leadUserId, req.user!.id]
        );
      }
      return updated;
    });
    if (!ministry) return void res.status(404).json({ error: "Ministry not found" });
    await audit(req.user!.id, "MINISTRY_UPDATED", "ministry", ministry.id, body);
    res.json({ message: "Ministry updated" });
  })
);

const ministryRoleInput = z
  .object({
    ministryId: uuid,
    name: z.string().trim().min(2),
    description: z.string().trim().nullable().optional(),
    minimumAge: z.number().int().min(0).max(120).default(0),
    maximumAge: z.number().int().min(0).max(120).nullable().optional(),
    requiresAdminApproval: z.boolean().default(false),
    isActive: z.boolean().default(true)
  })
  .refine((body) => body.maximumAge === null || body.maximumAge === undefined || body.maximumAge >= body.minimumAge, {
    message: "Maximum age must be greater than or equal to minimum age",
    path: ["maximumAge"]
  });

app.get(
  "/api/administration/roles",
  requireAuth,
  requireRole("ADMIN"),
  route(async (_req, res) => {
    res.json(
      await all(
        `select mr.id, mr.ministry_id, m.name ministry_name, mr.name, mr.description,
        mr.minimum_age, mr.maximum_age, mr.requires_admin_approval, mr.is_active, mr.created_at, mr.updated_at
        from ministry_roles mr join ministries m on m.id=mr.ministry_id
        order by mr.is_active desc, m.name, mr.name`
      )
    );
  })
);

app.post(
  "/api/administration/roles",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const body = ministryRoleInput.parse(req.body);
    const role = await get<{ id: string }>(
      `insert into ministry_roles(ministry_id, name, description, minimum_age, maximum_age, requires_admin_approval, is_active)
      values($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        body.ministryId,
        body.name,
        body.description || null,
        body.minimumAge,
        body.maximumAge ?? null,
        body.requiresAdminApproval,
        body.isActive
      ]
    );
    await audit(req.user!.id, "MINISTRY_ROLE_CREATED", "ministry_role", role!.id, body);
    res.status(201).json({ id: role!.id });
  })
);

app.patch(
  "/api/administration/roles/:roleId",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const roleId = uuid.parse(req.params.roleId);
    const body = ministryRoleInput.parse(req.body);
    const role = await get<{ id: string }>(
      `update ministry_roles set ministry_id=$1, name=$2, description=$3, minimum_age=$4, maximum_age=$5,
      requires_admin_approval=$6, is_active=$7 where id=$8 returning id`,
      [
        body.ministryId,
        body.name,
        body.description || null,
        body.minimumAge,
        body.maximumAge ?? null,
        body.requiresAdminApproval,
        body.isActive,
        roleId
      ]
    );
    if (!role) return void res.status(404).json({ error: "Role not found" });
    await audit(req.user!.id, "MINISTRY_ROLE_UPDATED", "ministry_role", role.id, body);
    res.json({ message: "Role updated" });
  })
);

app.get(
  "/api/events",
  requireAuth,
  route(async (req, res) => {
    const serveMode = req.query.serve === "true";
    const requestedSearch =
      typeof req.query.q === "string" ? z.string().trim().max(100).parse(req.query.q) || undefined : undefined;
    const search = requestedSearch && requestedSearch.length >= 2 ? requestedSearch : undefined;
    const requestedVolunteerId =
      serveMode && typeof req.query.volunteerId === "string" ? uuid.parse(req.query.volunteerId) : undefined;
    const assignmentVolunteerId =
      requestedVolunteerId && (hasRole(req.user!, "ADMIN") || hasRole(req.user!, "EVENT_LEADER"))
        ? requestedVolunteerId
        : req.user!.volunteerId;
    const visibleStatuses =
      serveMode || (!hasRole(req.user!, "ADMIN") && !hasRole(req.user!, "EVENT_LEADER"))
        ? ["ACTIVE"]
        : ["ACTIVE", "DRAFT"];
    const events = await all<Record<string, unknown>>(
      `select e.*, c.name campus_name,
       concat_ws(', ', c.address_line_1, nullif(c.address_line_2, ''), c.city, c.region || ' ' || c.postal_code) campus_address,
       coalesce((
         select array_agg(pc.name order by pc.name)
         from campuses pc
         where pc.id=any(e.participating_campus_ids)
       ), '{}') participating_campus_names,
       (
         exists (
           select 1 from user_home_campuses uhc
           where uhc.user_id=$3
             and (uhc.campus_id=e.campus_id or uhc.campus_id=any(e.participating_campus_ids))
         )
         or exists (
           select 1 from app_users u
           where u.id=$3 and u.home_campus_id is not null
             and (u.home_campus_id=e.campus_id or u.home_campus_id=any(e.participating_campus_ids))
         )
       ) matches_home_campus,
       coalesce(s.required_count, 0) required_count, coalesce(s.confirmed_count, 0) confirmed_count
     from events e join campuses c on c.id=e.campus_id
     left join event_staffing_summary s on s.event_id=e.id
     where ($4::boolean = false or e.ends_at>now()) and e.status=any($1::text[])
       and ($2::text is null
         or e.name ilike '%' || $2 || '%'
         or e.description ilike '%' || $2 || '%'
         or e.address ilike '%' || $2 || '%'
         or c.name ilike '%' || $2 || '%'
         or exists (select 1 from event_groups search_group where search_group.event_id=e.id and search_group.name ilike '%' || $2 || '%'))
     order by e.starts_at`,
      [visibleStatuses, search ?? null, req.user!.id, serveMode]
    );
    for (const event of events) {
      event.groups = await all(
        `select eg.*, egs.required_count, egs.confirmed_count, egs.open_count, egs.pending_count
       from event_groups eg join event_group_staffing egs on egs.event_group_id=eg.id
       where eg.event_id=$1 and eg.is_active order by eg.name`,
        [event.id]
      );
      if (assignmentVolunteerId)
        event.my_assignments = await all(
          `select a.id,a.status,a.event_group_id from assignments a join event_groups eg on eg.id=a.event_group_id
           where eg.event_id=$1 and a.volunteer_id=$2`,
          [event.id, assignmentVolunteerId]
        );
    }
    res.json(events);
  })
);

const eventGroupInput = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().default(""),
  instructions: z.string().trim().default(""),
  leaderUserIds: z.array(uuid).default([]),
  requiredVolunteerCount: z.number().int().nonnegative(),
  signupPolicy: z.enum(["AUTO", "APPROVAL"]).default("AUTO"),
  movementPolicy: z.enum(["AUTO", "APPROVAL"]).default("AUTO"),
  selfCheckinEnabled: z.boolean().default(false),
  isActive: z.boolean().default(true)
});

const eventTemplateTeamInput = eventGroupInput.omit({ isActive: true });
const eventTemplateInput = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).default(""),
  eventLeaderUserIds: z.array(uuid).default([]),
  teams: z.array(eventTemplateTeamInput).default([]),
  isActive: z.boolean().default(true)
});
const eventTemplateScheduleInput = z.object({
  eventName: z.string().trim().min(2).max(200),
  description: z.string().trim().default(""),
  campusId: uuid,
  address: z.string().trim().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  occurrence: z.number().int().min(1).max(24).default(1),
  interval: z
    .enum([
      "DAILY",
      "WEEKLY",
      "EVERY_2_WEEKS",
      "EVERY_3_WEEKS",
      "EVERY_4_WEEKS",
      "EVERY_5_WEEKS",
      "EVERY_6_WEEKS",
      "EVERY_7_WEEKS",
      "EVERY_8_WEEKS"
    ])
    .default("WEEKLY"),
  eventLeaderUserIds: z.array(uuid).min(1)
});

const eventInput = z.object({
  campusId: uuid,
  locationType: z.enum(["CAMPUS", "OFF_SITE"]).default("CAMPUS"),
  participatingCampusIds: z.array(uuid).default([]),
  name: z.string().trim().min(2),
  description: z.string().trim().default(""),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  address: z.string().trim(),
  latitude: z.number(),
  longitude: z.number(),
  eventLeaderUserIds: z.array(uuid).default([]),
  teams: z.array(eventTemplateTeamInput).default([])
});
const eventStatus = z.enum(["ACTIVE", "COMPLETE", "DRAFT", "CANCELLED", "REMOVED"]);
const eventUpdateInput = eventInput.extend({ status: eventStatus });

async function validateCampusIds(ids: string[]) {
  if (!ids.length) return;
  const result = await get<{ count: number }>(
    "select count(distinct id)::int count from campuses where id=any($1::uuid[]) and is_active",
    [ids]
  );
  if (result?.count !== new Set(ids).size) throw new ApiError("One or more selected campuses are invalid", 422);
}

async function validateLeaderIds(ids: string[], eligibleRoles: string[], leaderType: string) {
  if (!ids.length) return;
  const result = await get<{ count: number }>(
    `select count(distinct u.id)::int count
     from app_users u join app_user_roles aur on aur.user_id=u.id
     where u.id=any($1::uuid[]) and u.status='ACTIVE' and aur.role_code=any($2::text[])`,
    [ids, eligibleRoles]
  );
  if (result?.count !== new Set(ids).size)
    throw new ApiError(`One or more selected ${leaderType} leaders are invalid or inactive`, 422);
}

const validateEventLeaderIds = (ids: string[]) => validateLeaderIds(ids, ["ADMIN", "EVENT_LEADER"], "event");
const validateTeamLeaderIds = (ids: string[]) =>
  validateLeaderIds(ids, ["ADMIN", "EVENT_LEADER", "TEAM_LEADER"], "team");

async function validateEventTemplate(body: z.infer<typeof eventTemplateInput>) {
  for (const team of body.teams) {
    const ministry = await get<{ id: string }>("select id from ministries where name=$1 and is_active", [team.name]);
    if (team.name !== "Open" && !ministry) throw new ApiError("One or more selected ministries are invalid", 422);
  }
}

function normalizeEventTemplate(body: z.infer<typeof eventTemplateInput>): z.infer<typeof eventTemplateInput> {
  return {
    ...body,
    eventLeaderUserIds: [],
    teams: body.teams.map((team) => ({ ...team, leaderUserIds: [] }))
  };
}

function eventTemplateIntervalDays(interval: z.infer<typeof eventTemplateScheduleInput>["interval"]) {
  if (interval === "DAILY") return 1;
  if (interval === "WEEKLY") return 7;
  return Number(interval.match(/\d+/)?.[0] ?? 1) * 7;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

app.get(
  "/api/tools/event-templates",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const isAdmin = hasRole(req.user!, "ADMIN");
    const rows = await all<Record<string, unknown>>(
      `select et.*, coalesce(u.display_name, u.email) creator_name
       from event_templates et
       join app_users u on u.id=et.created_by
       where $1::boolean or et.created_by=$2
       order by et.is_active desc, et.updated_at desc, et.name`,
      [isAdmin, req.user!.id]
    );
    res.json(rows.map((row) => ({ ...row, can_edit: isAdmin || row.created_by === req.user!.id })));
  })
);

app.post(
  "/api/tools/event-templates",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const body = eventTemplateInput.parse(req.body);
    await validateEventTemplate(body);
    const templateBody = normalizeEventTemplate(body);
    const template = await get<Record<string, unknown>>(
      `insert into event_templates(
        name, description, event_leader_user_ids, teams, created_by, is_active
       )
       values($1,$2,$3,$4::jsonb,$5,$6)
       returning *`,
      [
        templateBody.name,
        templateBody.description,
        templateBody.eventLeaderUserIds,
        JSON.stringify(templateBody.teams),
        req.user!.id,
        templateBody.isActive
      ]
    );
    await audit(req.user!.id, "EVENT_TEMPLATE_CREATED", "event_template", String(template!.id));
    res.status(201).json(template);
  })
);

app.patch(
  "/api/tools/event-templates/:id",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = eventTemplateInput.parse(req.body);
    await validateEventTemplate(body);
    const templateBody = normalizeEventTemplate(body);
    const existing = await get<{ created_by: string }>("select created_by from event_templates where id=$1", [id]);
    if (!existing) throw new ApiError("Event template not found", 404);
    const isAdmin = hasRole(req.user!, "ADMIN");
    if (!isAdmin && existing.created_by !== req.user!.id)
      throw new ApiError("Only the template creator can edit this template", 403);
    const template = await get<Record<string, unknown>>(
      `update event_templates set
         name=$2, description=$3, event_leader_user_ids=$4, teams=$5::jsonb, is_active=$6
       where id=$1 returning *`,
      [
        id,
        templateBody.name,
        templateBody.description,
        templateBody.eventLeaderUserIds,
        JSON.stringify(templateBody.teams),
        templateBody.isActive
      ]
    );
    await audit(req.user!.id, "EVENT_TEMPLATE_UPDATED", "event_template", id);
    res.json(template);
  })
);

app.patch(
  "/api/tools/event-templates/:id/archive",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const existing = await get<{ created_by: string; name: string }>(
      "select created_by, name from event_templates where id=$1",
      [id]
    );
    if (!existing) throw new ApiError("Event template not found", 404);
    const isAdmin = hasRole(req.user!, "ADMIN");
    if (!isAdmin && existing.created_by !== req.user!.id)
      throw new ApiError("Only the template creator can archive this template", 403);
    await run("update event_templates set is_active=false where id=$1", [id]);
    await audit(req.user!.id, "EVENT_TEMPLATE_ARCHIVED", "event_template", id, { name: existing.name });
    res.json({ message: "Event template archived" });
  })
);

app.delete(
  "/api/tools/event-templates/:id",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const existing = await get<{ id: string; name: string; created_by: string }>(
      "select id, name, created_by from event_templates where id=$1",
      [id]
    );
    if (!existing) throw new ApiError("Event template not found", 404);
    const isAdmin = hasRole(req.user!, "ADMIN");
    if (!isAdmin && existing.created_by !== req.user!.id)
      throw new ApiError("Only the template creator can delete this template", 403);
    await run("delete from event_templates where id=$1", [id]);
    await audit(req.user!.id, "EVENT_TEMPLATE_DELETED", "event_template", id, { name: existing.name });
    res.json({ message: "Event template deleted" });
  })
);

app.post(
  "/api/tools/event-templates/:id/create-events",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = eventTemplateScheduleInput.parse(req.body);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) throw new ApiError("End date must be after start date", 422);
    await validateEventLeaderIds(body.eventLeaderUserIds);

    const campus = await get<{ id: string }>("select id from campuses where id=$1 and is_active", [body.campusId]);
    if (!campus) throw new ApiError("Selected campus is not available", 422);

    const isAdmin = hasRole(req.user!, "ADMIN");
    const template = await get<{
      id: string;
      created_by: string;
      teams: z.infer<typeof eventTemplateTeamInput>[];
    }>(
      `select id, created_by, teams
       from event_templates
       where id=$1 and is_active and ($2::boolean or created_by=$3)`,
      [id, isAdmin, req.user!.id]
    );
    if (!template) throw new ApiError("Event template not found", 404);
    const intervalDays = eventTemplateIntervalDays(body.interval);
    const created = await transaction(async (client) => {
      const eventIds: string[] = [];
      for (let index = 0; index < body.occurrence; index += 1) {
        const occurrenceStartsAt = addDays(startsAt, intervalDays * index);
        const occurrenceEndsAt = addDays(endsAt, intervalDays * index);
        const event = (
          await client.query<{ id: string }>(
            `insert into events(campus_id,name,description,starts_at,ends_at,address,latitude,longitude,event_leader_user_ids,status,created_by,
              location_type,participating_campus_ids)
             values($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10,'CAMPUS',array[$1]::uuid[]) returning id`,
            [
              body.campusId,
              body.eventName,
              body.description,
              occurrenceStartsAt.toISOString(),
              occurrenceEndsAt.toISOString(),
              body.address,
              body.latitude,
              body.longitude,
              body.eventLeaderUserIds,
              req.user!.id
            ]
          )
        ).rows[0]!;
        eventIds.push(event.id);

        for (const team of template.teams) {
          await client.query(
            `insert into event_groups(event_id,name,description,instructions,leader_user_ids,required_volunteer_count,
              signup_policy,movement_policy,self_checkin_enabled,is_active)
             values($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
            [
              event.id,
              team.name,
              team.description,
              team.instructions,
              [],
              team.requiredVolunteerCount,
              team.signupPolicy,
              team.movementPolicy,
              team.selfCheckinEnabled
            ]
          );
        }
      }
      return eventIds;
    });

    await audit(req.user!.id, "EVENTS_CREATED_FROM_TEMPLATE", "event_template", id, {
      ...body,
      createdEventIds: created
    });
    res.status(201).json({ eventIds: created, createdCount: created.length });
  })
);

app.get(
  "/api/tools/event-template-leaders",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (_req, res) => {
    res.json({
      eventLeaders: await all(
        `select u.id, u.display_name, u.email,
         array_agg(distinct aur.role_code order by aur.role_code) roles,
         coalesce(
           array_agg(distinct coalesce(uhc.campus_id, u.home_campus_id))
             filter (where coalesce(uhc.campus_id, u.home_campus_id) is not null),
           '{}'
         ) campus_ids
         from app_users u join app_user_roles aur on aur.user_id=u.id
         left join user_home_campuses uhc on uhc.user_id=u.id
         where u.status='ACTIVE' and aur.role_code in ('ADMIN', 'EVENT_LEADER')
         group by u.id
         order by coalesce(display_name, email), email`
      ),
      teamLeaders: await all(
        `select u.id, u.display_name, u.email,
         array_agg(distinct aur.role_code order by aur.role_code) roles,
         coalesce(
           array_agg(distinct coalesce(uhc.campus_id, u.home_campus_id))
             filter (where coalesce(uhc.campus_id, u.home_campus_id) is not null),
           '{}'
         ) campus_ids
         from app_users u join app_user_roles aur on aur.user_id=u.id
         left join user_home_campuses uhc on uhc.user_id=u.id
         where u.status='ACTIVE' and aur.role_code in ('ADMIN', 'EVENT_LEADER', 'TEAM_LEADER')
         group by u.id
         order by coalesce(display_name, email), email`
      )
    });
  })
);

app.post(
  "/api/events",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const body = eventInput.parse(req.body);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) throw new ApiError("End date must be after start date", 422);
    await validateEventLeaderIds(body.eventLeaderUserIds);
    for (const team of body.teams) await validateTeamLeaderIds(team.leaderUserIds);
    const participatingCampusIds = [
      ...new Set(body.participatingCampusIds.length ? body.participatingCampusIds : [body.campusId])
    ];
    await validateCampusIds([body.campusId, ...participatingCampusIds]);
    const eventId = await transaction(async (client) => {
      const event = (
        await client.query<{ id: string }>(
          `insert into events(campus_id,name,description,starts_at,ends_at,address,latitude,longitude,event_leader_user_ids,status,created_by,
             location_type,participating_campus_ids)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10,$11,$12) returning id`,
          [
            body.campusId,
            body.name,
            body.description,
            startsAt.toISOString(),
            endsAt.toISOString(),
            body.address,
            body.latitude,
            body.longitude,
            body.eventLeaderUserIds,
            req.user!.id,
            body.locationType,
            participatingCampusIds
          ]
        )
      ).rows[0]!;
      for (const team of body.teams) {
        await client.query(
          `insert into event_groups(event_id,name,description,instructions,leader_user_ids,required_volunteer_count,
             signup_policy,movement_policy,self_checkin_enabled,is_active)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
          [
            event.id,
            team.name,
            team.description,
            team.instructions,
            team.leaderUserIds,
            team.requiredVolunteerCount,
            team.signupPolicy,
            team.movementPolicy,
            team.selfCheckinEnabled
          ]
        );
      }
      return event.id;
    });
    await audit(req.user!.id, "EVENT_CREATED", "event", eventId, body);
    res.status(201).json({ id: eventId });
  })
);

app.patch(
  "/api/events/:eventId",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const eventId = uuid.parse(req.params.eventId);
    const body = eventUpdateInput.parse(req.body);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) throw new ApiError("End date must be after start date", 422);
    await validateEventLeaderIds(body.eventLeaderUserIds);
    const participatingCampusIds = [
      ...new Set(body.participatingCampusIds.length ? body.participatingCampusIds : [body.campusId])
    ];
    await validateCampusIds([body.campusId, ...participatingCampusIds]);
    const event = await get<{ id: string }>(
      `update events set campus_id=$1,name=$2,description=$3,starts_at=$4,ends_at=$5,address=$6,
       latitude=$7,longitude=$8,event_leader_user_ids=$9,status=$10,location_type=$11,participating_campus_ids=$12
       where id=$13 returning id`,
      [
        body.campusId,
        body.name,
        body.description,
        startsAt.toISOString(),
        endsAt.toISOString(),
        body.address,
        body.latitude,
        body.longitude,
        body.eventLeaderUserIds,
        body.status,
        body.locationType,
        participatingCampusIds,
        eventId
      ]
    );
    if (!event) return void res.status(404).json({ error: "Event not found" });
    await audit(req.user!.id, "EVENT_UPDATED", "event", event.id, body);
    res.json({ message: "Event updated" });
  })
);

app.get(
  "/api/administration/archived-events",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const isAdmin = hasRole(req.user!, "ADMIN");
    res.json(
      await all(
        `select e.id,e.name,e.description,e.starts_at,e.ends_at,e.status,e.address,e.latitude,e.longitude,
          c.name campus_name,
          coalesce(array_agg(distinct coalesce(u.display_name,u.email)) filter (where u.id is not null), '{}') event_leaders
         from events e join campuses c on c.id=e.campus_id
         left join app_users u on u.id=any(e.event_leader_user_ids)
         where e.status not in ('ACTIVE','DRAFT') and e.ends_at >= now() - interval '18 months'
           and ($1::boolean or $2::uuid=any(e.event_leader_user_ids))
         group by e.id,c.name
         order by e.starts_at desc`,
        [isAdmin, req.user!.id]
      )
    );
  })
);

app.get(
  "/api/administration/audit-logs",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const rawSearch = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
    const prefix = rawSearch.match(/^([a-z]+):\s*(.+)$/i);
    const allowedPrefixes = new Set(["date", "user", "action", "module", "target", "details"]);
    const searchColumn = prefix && allowedPrefixes.has(prefix[1]!.toLowerCase()) ? prefix[1]!.toLowerCase() : null;
    const searchValue = searchColumn ? prefix![2]!.trim() : rawSearch;
    const searchPattern = searchValue
      ? searchValue.includes("*")
        ? searchValue.replace(/[%_]/g, "\\$&").replace(/\*/g, "%") || "%"
        : `%${searchValue.replace(/[%_]/g, "\\$&")}%`
      : null;
    res.json(
      await all(
        `select id, actor_user_id, actor_name, actor_email, action, module, entity_type, entity_id, details,
          ip_address, entity_name, occurred_at
         from (
         select al.id, al.actor_user_id, coalesce(u.display_name, u.email, 'System') actor_name,
          u.email actor_email, al.action, al.module, al.entity_type, al.entity_id, al.details, al.ip_address,
          coalesce(
            case when al.entity_type='event' then ev.name end,
            case when al.entity_type='event_group' then eg.name end,
            case when al.entity_type='assignment' then concat_ws(' - ', ae.name, aeg.name) end,
            case when al.entity_type='volunteer' then concat_ws(' ', vp.first_name, nullif(vp.middle_name, ''), vp.last_name) end,
            case when al.entity_type='app_user' then coalesce(au.display_name, au.email) end,
            case when al.entity_type='campus' then ca.name end,
            case when al.entity_type='ministry' then mi.name end,
            case when al.entity_type='ministry_role' then mr.name end,
            case when al.entity_type='role' then ro.name end,
            case when al.entity_type='email_template' then emt.name end,
            case when al.entity_type='event_template' then evt.name end,
            case when al.entity_type='broadcast' then br.subject end,
            case when al.entity_type='task' then ta.title end,
            case when al.entity_type='conversation' then ce.name end
          ) entity_name,
          concat_ws(' ',
            to_char(al.occurred_at at time zone 'America/Chicago', 'Mon FMDD YYYY'),
            to_char(al.occurred_at at time zone 'America/Chicago', 'Month FMDD YYYY'),
            to_char(al.occurred_at at time zone 'America/Chicago', 'YYYY-MM-DD'),
            to_char(al.occurred_at at time zone 'America/Chicago', 'HH12:MI AM')
          ) occurred_at_search,
          al.occurred_at
         from audit_logs al
         left join app_users u on u.id=al.actor_user_id
         left join events ev on al.entity_type='event' and ev.id=al.entity_id
         left join event_groups eg on al.entity_type='event_group' and eg.id=al.entity_id
         left join assignments ass on al.entity_type='assignment' and ass.id=al.entity_id
         left join event_groups aeg on aeg.id=ass.event_group_id
         left join events ae on ae.id=aeg.event_id
         left join volunteer_profiles vp on al.entity_type='volunteer' and vp.id=al.entity_id
         left join app_users au on al.entity_type='app_user' and au.id=al.entity_id
         left join campuses ca on al.entity_type='campus' and ca.id=al.entity_id
         left join ministries mi on al.entity_type='ministry' and mi.id=al.entity_id
         left join ministry_roles mr on al.entity_type='ministry_role' and mr.id=al.entity_id
         left join roles ro on al.entity_type='role' and ro.code=al.details->>'code'
         left join email_templates emt on al.entity_type='email_template' and emt.id=al.entity_id
         left join event_templates evt on al.entity_type='event_template' and evt.id=al.entity_id
         left join broadcasts br on al.entity_type='broadcast' and br.id=al.entity_id
         left join tasks ta on al.entity_type='task' and ta.id=al.entity_id
         left join conversations co on al.entity_type='conversation' and co.id=al.entity_id
         left join events ce on ce.id=co.event_id
         ) audit
         where ($1::text is null and $2::text is null)
           or ($1::text is null and (
             action ilike $2 escape '\\'
             or module ilike $2 escape '\\'
             or entity_type ilike $2 escape '\\'
             or actor_name ilike $2 escape '\\'
             or coalesce(actor_email, '') ilike $2 escape '\\'
             or coalesce(entity_name, '') ilike $2 escape '\\'
             or coalesce(entity_id::text, '') ilike $2 escape '\\'
             or occurred_at_search ilike $2 escape '\\'
             or details::text ilike $2 escape '\\'
           ))
           or ($1='date' and occurred_at_search ilike $2 escape '\\')
           or ($1='user' and (actor_name ilike $2 escape '\\' or coalesce(actor_email, '') ilike $2 escape '\\'))
           or ($1='action' and action ilike $2 escape '\\')
           or ($1='module' and module ilike $2 escape '\\')
           or ($1='target' and (
             coalesce(entity_name, '') ilike $2 escape '\\'
             or entity_type ilike $2 escape '\\'
             or coalesce(entity_id::text, '') ilike $2 escape '\\'
           ))
           or ($1='details' and details::text ilike $2 escape '\\')
         order by occurred_at desc
         limit 250`,
        [searchColumn, searchPattern]
      )
    );
  })
);

app.patch(
  "/api/administration/events/:eventId/status",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const eventId = uuid.parse(req.params.eventId);
    const status = eventStatus.parse(req.body.status);
    const existing = await get<{ id: string; event_leader_user_ids: string[] }>(
      "select id,event_leader_user_ids from events where id=$1",
      [eventId]
    );
    if (!existing) return void res.status(404).json({ error: "Event not found" });
    if (!hasRole(req.user!, "ADMIN") && !existing.event_leader_user_ids.includes(req.user!.id)) {
      throw new ApiError("Outside your event scope", 403);
    }
    await run("update events set status=$1 where id=$2", [status, eventId]);
    await audit(req.user!.id, "EVENT_STATUS_UPDATED", "event", existing.id, { status });
    res.json({ message: "Event status updated" });
  })
);

app.post(
  "/api/events/:eventId/groups",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const eventId = uuid.parse(req.params.eventId);
    const body = eventGroupInput.parse(req.body);
    await validateTeamLeaderIds(body.leaderUserIds);
    const group = await get<{ id: string }>(
      `insert into event_groups(event_id,name,description,instructions,leader_user_ids,required_volunteer_count,
       signup_policy,movement_policy,self_checkin_enabled,is_active)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        eventId,
        body.name,
        body.description,
        body.instructions,
        body.leaderUserIds,
        body.requiredVolunteerCount,
        body.signupPolicy,
        body.movementPolicy,
        body.selfCheckinEnabled,
        body.isActive
      ]
    );
    await audit(req.user!.id, "EVENT_GROUP_CREATED", "event_group", group!.id, body);
    res.status(201).json({ id: group!.id });
  })
);

app.patch(
  "/api/event-groups/:eventGroupId",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const eventGroupId = uuid.parse(req.params.eventGroupId);
    const body = eventGroupInput.parse(req.body);
    await validateTeamLeaderIds(body.leaderUserIds);
    const group = await get<{ id: string }>(
      `update event_groups set name=$1,description=$2,instructions=$3,leader_user_ids=$4,
       required_volunteer_count=$5,signup_policy=$6,movement_policy=$7,self_checkin_enabled=$8,is_active=$9
       where id=$10 returning id`,
      [
        body.name,
        body.description,
        body.instructions,
        body.leaderUserIds,
        body.requiredVolunteerCount,
        body.signupPolicy,
        body.movementPolicy,
        body.selfCheckinEnabled,
        body.isActive,
        eventGroupId
      ]
    );
    if (!group) return void res.status(404).json({ error: "Event team not found" });
    await audit(req.user!.id, "EVENT_GROUP_UPDATED", "event_group", group.id, body);
    res.json({ message: "Event team updated" });
  })
);

app.post(
  "/api/event-groups/:eventGroupId/signup",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER", "VOLUNTEER"),
  route(async (req, res) => {
    const eventGroupId = uuid.parse(req.params.eventGroupId);
    const body = z.object({ volunteerId: uuid.optional() }).parse(req.body);
    const volunteerId = body.volunteerId ?? req.user!.volunteerId;
    if (!volunteerId) return void res.status(400).json({ error: "Choose a volunteer before signing up" });
    const proxyingAsLeader = hasRole(req.user!, "ADMIN") || hasRole(req.user!, "EVENT_LEADER");
    if (volunteerId !== req.user!.volunteerId) {
      if (!proxyingAsLeader) {
        const linked = await get(
          "select 1 from guardian_authorizations where guardian_volunteer_id=$1 and dependent_volunteer_id=$2 and status='ACTIVE'",
          [req.user!.volunteerId, volunteerId]
        );
        if (!linked) return void res.status(403).json({ error: "You may only schedule authorized dependents" });
      }
    }
    const volunteer = await get(
      "select id from volunteer_profiles where id=$1 and is_active and application_status='APPROVED'",
      [volunteerId]
    );
    if (!volunteer) return void res.status(422).json({ error: "The selected volunteer is not eligible to serve" });
    const group = await get<{
      signup_policy: string;
      signup_deadline?: Date;
      required_count: number;
      confirmed_count: number;
    }>(
      `select eg.signup_policy,coalesce(e.signup_deadline,eg.created_at + interval '100 years') signup_deadline,
       egs.required_count,egs.confirmed_count
       from event_groups eg join events e on e.id=eg.event_id
       join event_group_staffing egs on egs.event_group_id=eg.id
        where eg.id=$1 and eg.is_active and e.status='ACTIVE'`,
      [eventGroupId]
    );
    if (!group) return void res.status(404).json({ error: "Event team not found" });
    if (group.signup_deadline && new Date() > group.signup_deadline)
      return void res.status(409).json({ error: "Signup deadline has passed" });
    const status =
      group.signup_policy === "AUTO"
        ? group.confirmed_count >= group.required_count
          ? "WAITLISTED"
          : "CONFIRMED"
        : "REQUESTED";
    const assignment = await get<{ id: string }>(
      `insert into assignments(event_group_id,volunteer_id,status,requested_by,source) values($1,$2,$3,$4,$5) returning id`,
      [
        eventGroupId,
        volunteerId,
        status,
        req.user!.id,
        volunteerId === req.user!.volunteerId
          ? "VOLUNTEER"
          : hasRole(req.user!, "ADMIN")
            ? "ADMIN"
            : hasRole(req.user!, "EVENT_LEADER")
              ? "LEADER"
              : "GUARDIAN"
      ]
    );
    await audit(req.user!.id, "ASSIGNMENT_REQUESTED", "assignment", assignment!.id, { status });
    res.status(201).json({ id: assignment!.id, status });
  })
);

app.get(
  "/api/events/:eventId/roster",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const eventId = uuid.parse(req.params.eventId);
    const event = await get<{ event_leader_user_ids: string[] }>(
      "select event_leader_user_ids from events where id=$1",
      [eventId]
    );
    if (!event) return void res.status(404).json({ error: "Event not found" });
    if (hasRole(req.user!, "EVENT_LEADER") && !hasRole(req.user!, "ADMIN")) {
      const allowed =
        event.event_leader_user_ids.includes(req.user!.id) ||
        Boolean(
          await get("select 1 from event_groups where event_id=$1 and $2::uuid=any(leader_user_ids)", [
            eventId,
            req.user!.id
          ])
        );
      if (!allowed) return void res.status(403).json({ error: "Outside your event scope" });
    }
    res.json(
      await all(
        "select *,assignment_status status from event_roster where event_id=$1 order by event_group_name,last_name",
        [eventId]
      )
    );
  })
);

app.patch(
  "/api/assignments/:id/decision",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = z
      .object({ decision: z.enum(["CONFIRMED", "REJECTED"]), reason: z.string().optional() })
      .parse(req.body);
    const assignment = await get<{ leader_user_ids: string[]; event_leader_user_ids: string[] }>(
      `select eg.leader_user_ids,e.event_leader_user_ids from assignments a
       join event_groups eg on eg.id=a.event_group_id join events e on e.id=eg.event_id where a.id=$1`,
      [id]
    );
    if (!assignment) return void res.status(404).json({ error: "Assignment not found" });
    if (
      hasRole(req.user!, "EVENT_LEADER") &&
      !hasRole(req.user!, "ADMIN") &&
      !assignment.leader_user_ids.includes(req.user!.id) &&
      !assignment.event_leader_user_ids.includes(req.user!.id)
    )
      return void res.status(403).json({ error: "Outside your event team scope" });
    if (body.decision === "CONFIRMED") {
      const staffing = await get<{ required_count: number; confirmed_count: number }>(
        `select egs.required_count,egs.confirmed_count from assignments a
         join event_group_staffing egs on egs.event_group_id=a.event_group_id where a.id=$1`,
        [id]
      );
      if (staffing && staffing.confirmed_count >= staffing.required_count)
        return void res.status(409).json({ error: "This event team is already fully staffed" });
    }
    await run("update assignments set status=$1,decided_by=$2,decision_reason=$3,decided_at=now() where id=$4", [
      body.decision,
      req.user!.id,
      body.reason ?? null,
      id
    ]);
    await audit(req.user!.id, `ASSIGNMENT_${body.decision}`, "assignment", id, { reason: body.reason });
    res.json({ status: body.decision });
  })
);

app.post(
  "/api/assignments/:id/cancel",
  requireAuth,
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const assignment = await get<{ volunteer_id: string }>("select volunteer_id from assignments where id=$1", [id]);
    if (!assignment) return void res.status(404).json({ error: "Assignment not found" });
    if (
      hasRole(req.user!, "VOLUNTEER") &&
      !hasRole(req.user!, "ADMIN") &&
      !hasRole(req.user!, "EVENT_LEADER") &&
      assignment.volunteer_id !== req.user!.volunteerId
    )
      return void res.status(403).json({ error: "Cannot cancel another volunteer's assignment" });
    await run("update assignments set status='CANCELLED',cancelled_at=now() where id=$1", [id]);
    await audit(req.user!.id, "ASSIGNMENT_CANCELLED", "assignment", id);
    res.json({ status: "CANCELLED" });
  })
);

app.post(
  "/api/assignments/:id/checkin",
  requireAuth,
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = z
      .object({
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        status: z.enum(["CHECKED_IN", "PRESENT", "ABSENT", "EXCUSED"]).default("CHECKED_IN")
      })
      .parse(req.body);
    const assignment = await get<{
      volunteer_id: string;
      leader_user_ids: string[];
      event_leader_user_ids: string[];
      self_checkin_enabled: boolean;
      starts_at: Date;
      latitude: number;
      longitude: number;
      checkin_minutes_before: number;
      checkin_minutes_after: number;
      checkin_radius_meters: number;
    }>(
      `select a.volunteer_id,eg.leader_user_ids,e.event_leader_user_ids,eg.self_checkin_enabled,e.starts_at,e.latitude,e.longitude,eg.checkin_minutes_before,eg.checkin_minutes_after,eg.checkin_radius_meters
     from assignments a join event_groups eg on eg.id=a.event_group_id join events e on e.id=eg.event_id where a.id=$1`,
      [id]
    );
    if (!assignment) return void res.status(404).json({ error: "Assignment not found" });
    if (
      hasRole(req.user!, "EVENT_LEADER") &&
      !hasRole(req.user!, "ADMIN") &&
      !assignment.leader_user_ids.includes(req.user!.id) &&
      !assignment.event_leader_user_ids.includes(req.user!.id)
    )
      return void res.status(403).json({ error: "Outside your event team scope" });
    if (hasRole(req.user!, "VOLUNTEER") && !hasRole(req.user!, "ADMIN") && !hasRole(req.user!, "EVENT_LEADER")) {
      if (assignment.volunteer_id !== req.user!.volunteerId)
        return void res.status(403).json({ error: "Cannot check in another volunteer" });
      const now = Date.now(),
        start = assignment.starts_at.getTime();
      if (
        now < start - assignment.checkin_minutes_before * 60000 ||
        now > start + assignment.checkin_minutes_after * 60000
      )
        return void res.status(409).json({ error: "Outside the check-in window" });
      if (assignment.self_checkin_enabled) {
        if (body.latitude === undefined || body.longitude === undefined)
          return void res.status(409).json({ error: "Location is required for this check-in" });
        if (
          haversineMeters(body.latitude, body.longitude, Number(assignment.latitude), Number(assignment.longitude)) >
          assignment.checkin_radius_meters
        )
          return void res.status(409).json({ error: "Outside the check-in area" });
      }
    }
    await run(
      "update attendance set status=$1,checkin_at=now(),checkin_latitude=$2,checkin_longitude=$3,recorded_by=$4 where assignment_id=$5",
      [body.status, body.latitude ?? null, body.longitude ?? null, req.user!.id, id]
    );
    await audit(req.user!.id, "ATTENDANCE_RECORDED", "assignment", id, { status: body.status });
    res.json({ status: body.status });
  })
);

app.get(
  "/api/applications",
  requireAuth,
  requireRole("ADMIN"),
  route(async (_req, res) => {
    res.json(
      await all(
        `select vp.*,u.email,u.phone from volunteer_profiles vp left join app_users u on u.id=vp.app_user_id where vp.application_status in ('SUBMITTED','REJECTED') order by vp.created_at desc`
      )
    );
  })
);

app.patch(
  "/api/applications/:id",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = z.object({ status: z.enum(["APPROVED", "REJECTED"]), reason: z.string().optional() }).parse(req.body);
    await run(
      "update volunteer_profiles set application_status=$1,application_decided_at=now(),application_decided_by=$2,application_decision_reason=$3 where id=$4",
      [body.status, req.user!.id, body.reason ?? null, id]
    );
    await audit(req.user!.id, `APPLICATION_${body.status}`, "volunteer", id, { reason: body.reason });
    res.json({ status: body.status });
  })
);

app.get(
  "/api/administration/volunteers",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER", "TEAM_LEADER", "MINISTRY_HEAD"),
  route(async (req, res) => {
    const search = typeof req.query.q === "string" ? z.string().trim().max(160).parse(req.query.q) : "";
    const marker = search.slice(0, 1);
    const searchType = marker === ":" ? "ROLE" : marker === "^" ? "CAMPUS" : marker === "!" ? "MINISTRY" : "TEXT";
    const searchTerm = searchType === "TEXT" ? search : search.slice(1).trim();
    res.json(
      await all(
        `with directory as (
           select vd.*,
             coalesce(hc.name, 'Campus not assigned') home_campus,
             coalesce((
               select array_agg(aur.role_code order by aur.role_code)
               from app_user_roles aur where aur.user_id=vd.user_id
             ), '{}'::text[]) roles,
             coalesce((
               select array_agg(distinct assigned.name order by assigned.name)
               from (
                 select m.name
                 from user_ministry_memberships umm
                 join ministries m on m.id=umm.ministry_id
                 where umm.user_id=vd.user_id
                 union
                 select m.name
                 from leader_ministries lm
                 join ministries m on m.id=lm.ministry_id
                 where lm.user_id=vd.user_id
                 union
                 select m.name
                 from ministry_campus_leads mcl
                 join ministries m on m.id=mcl.ministry_id
                 where mcl.lead_user_id=vd.user_id
                 union
                 select m.name
                 from volunteer_role_eligibility vre
                 join ministry_roles mr on mr.id=vre.role_id
                 join ministries m on m.id=mr.ministry_id
                 where vre.volunteer_id=vd.volunteer_id
                   and vre.status in ('PENDING', 'ELIGIBLE')
               ) assigned
             ), '{}'::text[]) ministries
           from volunteer_directory vd
           left join app_users u on u.id=vd.user_id
           left join campuses hc on hc.id=u.home_campus_id
         )
         select * from directory
         where ($1::text='' or
           ($2::text='TEXT' and (
             first_name ilike '%' || $1 || '%' or middle_name ilike '%' || $1 || '%'
             or last_name ilike '%' || $1 || '%' or preferred_name ilike '%' || $1 || '%'
             or email ilike '%' || $1 || '%'
           ))
           or ($2::text='ROLE' and array_to_string(roles, ' ') ilike '%' || replace($1, ' ', '_') || '%')
           or ($2::text='CAMPUS' and home_campus ilike '%' || $1 || '%')
           or ($2::text='MINISTRY' and array_to_string(ministries, ' ') ilike '%' || $1 || '%'))
         order by last_name,first_name limit $3`,
        [searchTerm, searchType, search ? 100 : 1000]
      )
    );
  })
);

app.post(
  "/api/broadcasts",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER", "TEAM_LEADER"),
  route(async (req, res) => {
    const body = z
      .object({
        eventId: uuid,
        eventGroupIds: z.array(uuid).default([]),
        emailTemplateId: uuid.nullish(),
        subject: z.string().min(1),
        message: z.string().min(1),
        channels: z.array(z.enum(["PUSH", "EMAIL", "SMS"])).min(1),
        intendedRecipients: z.enum(["ENLISTED", "NOT_ENLISTED", "BOTH"])
      })
      .parse(req.body);
    const event = await get<{ id: string; event_leader_user_ids: string[] }>(
      "select id,event_leader_user_ids from events where id=$1 and status in ('ACTIVE','DRAFT')",
      [body.eventId]
    );
    if (!event) throw new ApiError("Event not found", 404);
    const selectedGroups = body.eventGroupIds.length
      ? await all<{ id: string; leader_user_ids: string[] }>(
          "select id,leader_user_ids from event_groups where event_id=$1 and id=any($2::uuid[]) and is_active",
          [body.eventId, body.eventGroupIds]
        )
      : [];
    if (selectedGroups.length !== new Set(body.eventGroupIds).size)
      throw new ApiError("One or more selected event teams do not belong to this event", 422);
    const isAdmin = hasRole(req.user!, "ADMIN");
    const isEventLeader = event.event_leader_user_ids.includes(req.user!.id);
    const leadsEverySelectedTeam =
      selectedGroups.length > 0 && selectedGroups.every((group) => group.leader_user_ids.includes(req.user!.id));
    if (!isAdmin && !isEventLeader && !leadsEverySelectedTeam)
      throw new ApiError("You can only broadcast to events or event teams you lead", 403);
    if (body.emailTemplateId) {
      const template = await get<{ id: string }>("select id from email_templates where id=$1 and is_active", [
        body.emailTemplateId
      ]);
      if (!template) throw new ApiError("The selected email template is not available", 422);
    }
    const item = await get<{ id: string }>(
      `insert into broadcasts(sender_id,event_id,email_template_id,subject,message,channels,audience_filter,status)
     values($1,$2,$3,$4,$5,$6,$7::jsonb,'QUEUED') returning id`,
      [
        req.user!.id,
        body.eventId,
        body.emailTemplateId ?? null,
        body.subject,
        body.message,
        body.channels,
        JSON.stringify({ intendedRecipients: body.intendedRecipients, eventGroupIds: body.eventGroupIds })
      ]
    );
    await run(
      `with recipients as (
         select distinct u.id
         from app_users u
         join volunteer_profiles vp on vp.app_user_id=u.id
         where u.status='ACTIVE' and vp.is_active and vp.application_status='APPROVED'
           and (
             ($2::text in ('ENLISTED','BOTH') and exists (
               select 1 from assignments a join event_groups eg on eg.id=a.event_group_id
               where a.volunteer_id=vp.id and eg.event_id=$3
                 and a.status in ('REQUESTED','WAITLISTED','CONFIRMED','COMPLETED')
                 and (cardinality($4::uuid[])=0 or eg.id=any($4::uuid[]))
             ))
             or ($2::text in ('NOT_ENLISTED','BOTH') and not exists (
               select 1 from assignments a join event_groups eg on eg.id=a.event_group_id
               where a.volunteer_id=vp.id and eg.event_id=$3
                 and a.status in ('REQUESTED','WAITLISTED','CONFIRMED','COMPLETED')
                 and (cardinality($4::uuid[])=0 or eg.id=any($4::uuid[]))
             ))
           )
       )
       insert into broadcast_deliveries(broadcast_id,recipient_user_id,channel)
       select $1,r.id,channel from recipients r cross join unnest($5::text[]) channel`,
      [item!.id, body.intendedRecipients, body.eventId, body.eventGroupIds, body.channels]
    );
    await run("insert into outbox_jobs(job_type,payload) values('BROADCAST_CREATED',$1::jsonb)", [
      JSON.stringify({ broadcastId: item!.id })
    ]);
    await audit(req.user!.id, "BROADCAST_QUEUED", "broadcast", item!.id, body);
    res.status(201).json({ id: item!.id, deliveryStatus: "QUEUED" });
  })
);

const taskPriority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const taskInput = z.object({
  eventGroupId: uuid,
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).default(""),
  location: z.string().trim().max(300).default(""),
  requiredVolunteers: z.number().int().min(1).max(50).default(1),
  priority: taskPriority.default("NORMAL")
});

type TaskScope = {
  id: string;
  status: string;
  leader_user_ids: string[];
  event_leader_user_ids: string[];
};

function canManageTask(user: NonNullable<AuthedRequest["user"]>, task: TaskScope) {
  return (
    hasRole(user, "ADMIN") || task.leader_user_ids.includes(user.id) || task.event_leader_user_ids.includes(user.id)
  );
}

async function taskScope(taskId: string) {
  return get<TaskScope>(
    `select t.id,t.status,eg.leader_user_ids,e.event_leader_user_ids
     from tasks t join event_groups eg on eg.id=t.event_group_id join events e on e.id=t.event_id
     where t.id=$1`,
    [taskId]
  );
}

app.post(
  "/api/tasks",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER", "TEAM_LEADER", "MINISTRY_HEAD"),
  route(async (req, res) => {
    const body = taskInput.parse(req.body);
    const group = await get<{
      event_id: string;
      leader_user_ids: string[];
      event_leader_user_ids: string[];
    }>(
      `select eg.event_id,eg.leader_user_ids,e.event_leader_user_ids
       from event_groups eg join events e on e.id=eg.event_id
       where eg.id=$1 and eg.is_active and e.status='ACTIVE'`,
      [body.eventGroupId]
    );
    if (!group) return void res.status(404).json({ error: "Active event team not found" });
    if (
      !hasRole(req.user!, "ADMIN") &&
      !group.leader_user_ids.includes(req.user!.id) &&
      !group.event_leader_user_ids.includes(req.user!.id)
    )
      return void res.status(403).json({ error: "Outside your event team scope" });

    const result = await transaction(async (client) => {
      const task = (
        await client.query<{ id: string }>(
          `insert into tasks(event_id,event_group_id,title,description,location,required_volunteers,priority,created_by_user_id)
           values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [
            group.event_id,
            body.eventGroupId,
            body.title,
            body.description || null,
            body.location || null,
            body.requiredVolunteers,
            body.priority,
            req.user!.id
          ]
        )
      ).rows[0]!;
      const recipients = await client.query(
        `insert into task_recipients(task_id,volunteer_id)
         select $1,a.volunteer_id from assignments a
         where a.event_group_id=$2 and a.status='CONFIRMED'
         on conflict do nothing`,
        [task.id, body.eventGroupId]
      );
      await client.query("insert into outbox_jobs(job_type,payload) values('TASK_CREATED',$1::jsonb)", [
        JSON.stringify({ taskId: task.id })
      ]);
      return { id: task.id, recipientCount: recipients.rowCount ?? 0 };
    });
    await audit(req.user!.id, "TASK_CREATED", "task", result.id, body);
    res.status(201).json(result);
  })
);

app.patch(
  "/api/administration/tasks/:id",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER", "TEAM_LEADER", "MINISTRY_HEAD"),
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = taskInput.parse(req.body);
    const scopedTask = await taskScope(id);
    if (!scopedTask) throw new ApiError("Task not found", 404);
    if (!canManageTask(req.user!, scopedTask)) throw new ApiError("Outside your event team scope", 403);
    const result = await transaction(async (client) => {
      const existing = (
        await client.query<{ event_group_id: string; status: string }>(
          "select event_group_id,status from tasks where id=$1 for update",
          [id]
        )
      ).rows[0];
      if (!existing) throw new ApiError("Task not found", 404);
      if (!["OPEN", "STAFFED"].includes(existing.status))
        throw new ApiError("Tasks can only be edited before work starts", 409);
      const activeClaims = (
        await client.query<{ count: number }>(
          "select count(*)::int count from task_claims where task_id=$1 and status='CLAIMED'",
          [id]
        )
      ).rows[0]!.count;

      const group = (
        await client.query<{ event_id: string; leader_user_ids: string[]; event_leader_user_ids: string[] }>(
          `select eg.event_id,eg.leader_user_ids,e.event_leader_user_ids
           from event_groups eg join events e on e.id=eg.event_id
           where eg.id=$1 and eg.is_active and e.status='ACTIVE'`,
          [body.eventGroupId]
        )
      ).rows[0];
      if (!group) throw new ApiError("Active event team not found", 404);
      if (
        !hasRole(req.user!, "ADMIN") &&
        !group.leader_user_ids.includes(req.user!.id) &&
        !group.event_leader_user_ids.includes(req.user!.id)
      ) {
        throw new ApiError("Outside your event team scope", 403);
      }
      const groupChanged = existing.event_group_id !== body.eventGroupId;
      if (groupChanged && activeClaims > 0)
        throw new ApiError("Remove active claims before changing the event group", 409);
      if (body.requiredVolunteers < activeClaims)
        throw new ApiError("Required volunteers cannot be lower than the current claim count", 409);

      await client.query(
        `update tasks set event_id=$1,event_group_id=$2,title=$3,description=$4,location=$5,
          required_volunteers=$6::integer,priority=$7,
          status=case when $6::integer <= $8::integer then 'STAFFED' else 'OPEN' end
         where id=$9`,
        [
          group.event_id,
          body.eventGroupId,
          body.title,
          body.description || null,
          body.location || null,
          body.requiredVolunteers,
          body.priority,
          activeClaims,
          id
        ]
      );
      if (groupChanged) {
        await client.query("delete from task_recipients where task_id=$1", [id]);
        await client.query(
          `insert into task_recipients(task_id,volunteer_id)
           select $1,a.volunteer_id from assignments a
           where a.event_group_id=$2 and a.status='CONFIRMED'
           on conflict do nothing`,
          [id, body.eventGroupId]
        );
      }
      return { groupChanged };
    });
    await audit(req.user!.id, "TASK_UPDATED", "task", id, body);
    res.json({ message: "Task updated", ...result });
  })
);

app.get(
  "/api/administration/tasks",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER", "TEAM_LEADER", "MINISTRY_HEAD"),
  route(async (req, res) => {
    const isAdmin = hasRole(req.user!, "ADMIN");
    res.json(
      await all(
        `select t.id,t.event_id,t.event_group_id,t.title,t.description,t.location,t.required_volunteers,t.priority,t.status,
          t.started_at,t.completed_at,t.created_at,t.updated_at,e.name event_name,e.starts_at,e.ends_at,
          eg.name event_group_name,c.name campus_name,
          coalesce(u.display_name,u.email) created_by,
          count(distinct tr.volunteer_id)::int recipient_count,
          count(distinct tc.volunteer_id) filter (where tc.status='CLAIMED')::int claimed_volunteers,
          coalesce(
            array_agg(distinct concat_ws(' ',vp.first_name,vp.middle_name,vp.last_name))
              filter (where tc.status='CLAIMED'),
            '{}'
          ) claimed_volunteer_names
         from tasks t join event_groups eg on eg.id=t.event_group_id join events e on e.id=t.event_id
         join campuses c on c.id=e.campus_id
         left join app_users u on u.id=t.created_by_user_id
         left join task_recipients tr on tr.task_id=t.id
         left join task_claims tc on tc.task_id=t.id
         left join volunteer_profiles vp on vp.id=tc.volunteer_id
         where ($1::boolean or $2::uuid=any(eg.leader_user_ids) or $2::uuid=any(e.event_leader_user_ids)
           or t.created_by_user_id=$2)
         group by t.id,e.id,eg.id,c.id,u.id
         order by t.created_at desc`,
        [isAdmin, req.user!.id]
      )
    );
  })
);

app.get(
  "/api/my-tasks",
  requireAuth,
  route(async (req, res) => {
    res.json(
      await all(
        `select t.id,t.title,t.description,t.location,t.required_volunteers,t.priority,t.status,
          t.started_at,t.completed_at,t.created_at,e.name event_name,e.starts_at,e.ends_at,
          eg.name event_group_name,c.name campus_name,
          count(distinct tc.volunteer_id) filter (where tc.status='CLAIMED')::int claimed_volunteers,
          coalesce(bool_or(tc.volunteer_id=$1::uuid and tc.status='CLAIMED'),false) claimed_by_me,
          ($2::uuid=any(eg.leader_user_ids) or $2::uuid=any(e.event_leader_user_ids) or $3::boolean) can_manage,
          coalesce(
            array_agg(distinct concat_ws(' ',vp.first_name,vp.middle_name,vp.last_name))
              filter (where tc.status='CLAIMED'),
            '{}'
          ) claimed_volunteer_names
         from tasks t
         join event_groups eg on eg.id=t.event_group_id join events e on e.id=t.event_id
         join campuses c on c.id=e.campus_id
         left join task_recipients tr on tr.task_id=t.id
         left join task_claims tc on tc.task_id=t.id
         left join volunteer_profiles vp on vp.id=tc.volunteer_id
         where t.status not in ('COMPLETED','CANCELLED')
           and (
             (
               t.status in ('OPEN','STAFFED')
               and (
                 tr.volunteer_id=$1::uuid
                 or $2::uuid=any(eg.leader_user_ids)
                 or $2::uuid=any(e.event_leader_user_ids)
                 or $3::boolean
               )
             )
             or (
               t.status='IN_PROGRESS'
               and (
                 (tc.volunteer_id=$1::uuid and tc.status='CLAIMED')
                 or $2::uuid=any(eg.leader_user_ids)
                 or $2::uuid=any(e.event_leader_user_ids)
                 or $3::boolean
               )
             )
           )
         group by t.id,e.id,eg.id,c.id
         order by t.created_at desc`,
        [req.user!.volunteerId ?? null, req.user!.id, hasRole(req.user!, "ADMIN")]
      )
    );
  })
);

app.post(
  "/api/tasks/:id/claim",
  requireAuth,
  route(async (req, res) => {
    if (!req.user!.volunteerId) return void res.status(400).json({ error: "No volunteer profile" });
    const id = uuid.parse(req.params.id);
    const result = await transaction(async (client) => {
      const task = (
        await client.query<{ required_volunteers: number; status: string }>(
          "select required_volunteers,status from tasks where id=$1 for update",
          [id]
        )
      ).rows[0];
      if (!task) throw new ApiError("Task not found", 404);
      if (task.status !== "OPEN") throw new ApiError("This task is not accepting additional volunteers", 409);
      const recipient = await client.query("select 1 from task_recipients where task_id=$1 and volunteer_id=$2", [
        id,
        req.user!.volunteerId
      ]);
      if (!recipient.rowCount) throw new ApiError("This task was not assigned to your event team", 403);
      const existing = (
        await client.query<{ status: string }>("select status from task_claims where task_id=$1 and volunteer_id=$2", [
          id,
          req.user!.volunteerId
        ])
      ).rows[0];
      if (existing?.status === "CLAIMED") throw new ApiError("You have already claimed this task", 409);
      const count = (
        await client.query<{ count: number }>(
          "select count(*)::int count from task_claims where task_id=$1 and status='CLAIMED'",
          [id]
        )
      ).rows[0]!.count;
      if (count >= task.required_volunteers) throw new ApiError("This task already has enough volunteers", 409);
      await client.query(
        `insert into task_claims(task_id,volunteer_id) values($1,$2)
         on conflict(task_id,volunteer_id) do update
         set status='CLAIMED',claimed_at=now(),withdrawn_at=null`,
        [id, req.user!.volunteerId]
      );
      const claimedVolunteers = count + 1;
      const status = claimedVolunteers >= task.required_volunteers ? "STAFFED" : "OPEN";
      await client.query("update tasks set status=$1 where id=$2", [status, id]);
      await client.query("insert into outbox_jobs(job_type,payload) values('TASK_CLAIMED',$1::jsonb)", [
        JSON.stringify({ taskId: id, volunteerId: req.user!.volunteerId, status })
      ]);
      return { status, claimedVolunteers, requiredVolunteers: task.required_volunteers };
    });
    await audit(req.user!.id, "TASK_CLAIMED", "task", id);
    res.json(result);
  })
);

app.post(
  "/api/tasks/:id/withdraw",
  requireAuth,
  route(async (req, res) => {
    if (!req.user!.volunteerId) return void res.status(400).json({ error: "No volunteer profile" });
    const id = uuid.parse(req.params.id);
    const result = await transaction(async (client) => {
      const task = (await client.query<{ status: string }>("select status from tasks where id=$1 for update", [id]))
        .rows[0];
      if (!task) throw new ApiError("Task not found", 404);
      if (!["OPEN", "STAFFED"].includes(task.status))
        throw new ApiError("You cannot withdraw after work has started", 409);
      const claim = await client.query(
        `update task_claims set status='WITHDRAWN',withdrawn_at=now()
         where task_id=$1 and volunteer_id=$2 and status='CLAIMED' returning task_id`,
        [id, req.user!.volunteerId]
      );
      if (!claim.rowCount) throw new ApiError("You have not claimed this task", 409);
      const claimedVolunteers = (
        await client.query<{ count: number }>(
          "select count(*)::int count from task_claims where task_id=$1 and status='CLAIMED'",
          [id]
        )
      ).rows[0]!.count;
      await client.query("update tasks set status='OPEN' where id=$1", [id]);
      return { status: "OPEN", claimedVolunteers };
    });
    await audit(req.user!.id, "TASK_WITHDRAWN", "task", id);
    res.json(result);
  })
);

app.post(
  "/api/tasks/:id/start",
  requireAuth,
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const task = await taskScope(id);
    if (!task) return void res.status(404).json({ error: "Task not found" });
    const isClaimant = Boolean(
      req.user!.volunteerId &&
      (await get("select 1 from task_claims where task_id=$1 and volunteer_id=$2 and status='CLAIMED'", [
        id,
        req.user!.volunteerId
      ]))
    );
    if (!isClaimant && !canManageTask(req.user!, task))
      return void res.status(403).json({ error: "Only claimants or event leaders can start this task" });
    const updated = await get<{ id: string }>(
      "update tasks set status='IN_PROGRESS',started_at=now(),started_by_user_id=$1 where id=$2 and status='STAFFED' returning id",
      [req.user!.id, id]
    );
    if (!updated) return void res.status(409).json({ error: "Task must be fully staffed before it can start" });
    await audit(req.user!.id, "TASK_STARTED", "task", id);
    res.json({ status: "IN_PROGRESS" });
  })
);

app.post(
  "/api/tasks/:id/complete",
  requireAuth,
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const task = await taskScope(id);
    if (!task) return void res.status(404).json({ error: "Task not found" });
    const isClaimant = Boolean(
      req.user!.volunteerId &&
      (await get("select 1 from task_claims where task_id=$1 and volunteer_id=$2 and status='CLAIMED'", [
        id,
        req.user!.volunteerId
      ]))
    );
    if (!isClaimant && !canManageTask(req.user!, task))
      return void res.status(403).json({ error: "Only claimants or event leaders can complete this task" });
    const updated = await get<{ id: string }>(
      `update tasks set status='COMPLETED',completed_at=now(),completed_by_user_id=$1
       where id=$2 and status='IN_PROGRESS' returning id`,
      [req.user!.id, id]
    );
    if (!updated) return void res.status(409).json({ error: "Task must be in progress before it can be completed" });
    await audit(req.user!.id, "TASK_COMPLETED", "task", id);
    res.json({ status: "COMPLETED" });
  })
);

app.get(
  "/api/broadcasts",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER", "TEAM_LEADER"),
  route(async (req, res) => {
    res.json(
      await all(
        `select b.*,u.email sender_email,e.name event_name,et.name email_template_name
         from broadcasts b
         join app_users u on u.id=b.sender_id
         join events e on e.id=b.event_id
         left join email_templates et on et.id=b.email_template_id
         where ($1::boolean or b.sender_id=$2 or $2::uuid=any(e.event_leader_user_ids)
           or exists (select 1 from event_groups eg where eg.event_id=e.id and $2::uuid=any(eg.leader_user_ids)))
         order by b.created_at desc`,
        [hasRole(req.user!, "ADMIN"), req.user!.id]
      )
    );
  })
);

async function accessibleConversation(conversationId: string, userId: string, volunteerId?: string) {
  return get<{ id: string }>(
    `select id from conversations
     where id=$1 and (leader_user_id=$2 or ($3::uuid is not null and volunteer_id=$3))`,
    [conversationId, userId, volunteerId ?? null]
  );
}

app.post(
  "/api/event-groups/:id/group-chat-access",
  requireAuth,
  route(async (req, res) => {
    const eventGroupId = uuid.parse(req.params.id);
    const group = await get<{
      event_name: string;
      event_group_name: string;
      display_name: string;
      is_member: boolean;
    }>(
      `select e.name event_name,eg.name event_group_name,coalesce(u.display_name,u.email) display_name,
       ($2::boolean or $3::uuid=any(eg.leader_user_ids) or $3::uuid=any(e.event_leader_user_ids) or exists (
         select 1 from assignments a where a.event_group_id=eg.id and a.volunteer_id=$4::uuid
           and a.status in ('CONFIRMED','COMPLETED')
       )) is_member
       from event_groups eg join events e on e.id=eg.event_id join app_users u on u.id=$3
       where eg.id=$1 and eg.is_active`,
      [eventGroupId, hasRole(req.user!, "ADMIN"), req.user!.id, req.user!.volunteerId ?? null]
    );
    if (!group?.is_member) return void res.status(404).json({ error: "Event-team group chat not found" });

    const access = await createTwilioConversationAccess({
      eventGroupId,
      eventName: group.event_name,
      eventGroupName: group.event_group_name,
      userId: req.user!.id,
      displayName: group.display_name
    });
    await audit(req.user!.id, "GROUP_CHAT_JOINED", "event_group", eventGroupId);
    res.json({ ...access, eventName: group.event_name, eventGroupName: group.event_group_name });
  })
);

async function queueRelayMessage(conversationId: string, senderUserId: string, body: string) {
  const message = await get<{ id: string }>(
    `insert into messages(conversation_id,sender_user_id,body,channel)
     values($1,$2,$3,'SMS') returning id`,
    [conversationId, senderUserId, body]
  );
  await run("insert into outbox_jobs(job_type,payload) values('SMS_RELAY_MESSAGE',$1::jsonb)", [
    JSON.stringify({ messageId: message!.id })
  ]);
  await run("update conversations set status='OPEN',updated_at=now() where id=$1", [conversationId]);
  return message!;
}

app.get(
  "/api/conversations",
  requireAuth,
  route(async (req, res) => {
    res.json(
      await all(
        `select c.id,c.status,c.updated_at,(c.leader_user_id=$1) is_leader,e.name event_name,eg.name event_group_name,
         concat_ws(' ',vp.first_name,vp.middle_name,vp.last_name) volunteer_name,
         coalesce(lu.display_name,lu.email) leader_name,
         lm.body latest_message,lm.created_at latest_message_at,
         count(um.id)::int unread_count
         from conversations c join events e on e.id=c.event_id
         left join event_groups eg on eg.id=c.event_group_id
         join volunteer_profiles vp on vp.id=c.volunteer_id
         join app_users lu on lu.id=c.leader_user_id
         left join lateral (
           select body,created_at from messages where conversation_id=c.id order by created_at desc limit 1
         ) lm on true
         left join conversation_read_states crs on crs.conversation_id=c.id and crs.user_id=$1
         left join messages um on um.conversation_id=c.id and um.sender_user_id<>$1
           and um.created_at>coalesce(crs.last_read_at,'epoch'::timestamptz)
         where c.leader_user_id=$1 or ($2::uuid is not null and c.volunteer_id=$2)
         group by c.id,e.name,eg.name,vp.first_name,vp.middle_name,vp.last_name,lu.display_name,lu.email,lm.body,lm.created_at
         order by coalesce(lm.created_at,c.updated_at) desc`,
        [req.user!.id, req.user!.volunteerId ?? null]
      )
    );
  })
);

app.get(
  "/api/conversations/:id/messages",
  requireAuth,
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    if (!(await accessibleConversation(id, req.user!.id, req.user!.volunteerId)))
      return void res.status(404).json({ error: "Conversation not found" });
    await run(
      `insert into conversation_read_states(conversation_id,user_id,last_read_at) values($1,$2,now())
       on conflict(conversation_id,user_id) do update set last_read_at=excluded.last_read_at`,
      [id, req.user!.id]
    );
    res.json(
      await all(
        `select m.id,m.body,m.channel,m.delivery_status,m.created_at,m.sender_user_id,
         coalesce(u.display_name,u.email) sender_name,(m.sender_user_id=$2) is_mine
         from messages m join app_users u on u.id=m.sender_user_id
         where m.conversation_id=$1 order by m.created_at`,
        [id, req.user!.id]
      )
    );
  })
);

app.post(
  "/api/conversations/:id/messages",
  requireAuth,
  route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = z.object({ message: z.string().trim().min(1).max(1600) }).parse(req.body);
    if (!(await accessibleConversation(id, req.user!.id, req.user!.volunteerId)))
      return void res.status(404).json({ error: "Conversation not found" });
    const message = await queueRelayMessage(id, req.user!.id, body.message);
    await audit(req.user!.id, "MESSAGE_SENT", "conversation", id, { messageId: message.id });
    res.status(201).json({ id: message.id, deliveryStatus: "QUEUED" });
  })
);

app.post(
  "/api/conversations",
  requireAuth,
  requireRole("VOLUNTEER"),
  route(async (req, res) => {
    if (!req.user!.volunteerId) return void res.status(400).json({ error: "No volunteer profile" });
    const body = z.object({ eventGroupId: uuid, message: z.string().trim().min(1).max(1600) }).parse(req.body);
    const group = await get<{ event_id: string; leader_user_id?: string }>(
      `select eg.event_id,coalesce(eg.leader_user_ids[1],e.event_leader_user_ids[1]) leader_user_id
       from event_groups eg join events e on e.id=eg.event_id where eg.id=$1`,
      [body.eventGroupId]
    );
    if (!group?.leader_user_id) return void res.status(409).json({ error: "No leader is assigned to this event team" });
    const conversation = await get<{ id: string }>(
      `insert into conversations(event_id,event_group_id,volunteer_id,leader_user_id) values($1,$2,$3,$4)
     on conflict(event_id,volunteer_id,leader_user_id) do update set status='OPEN' returning id`,
      [group.event_id, body.eventGroupId, req.user!.volunteerId, group.leader_user_id]
    );
    const message = await queueRelayMessage(conversation!.id, req.user!.id, body.message);
    await audit(req.user!.id, "MESSAGE_SENT", "conversation", conversation!.id, { messageId: message.id });
    res.status(201).json({ id: conversation!.id, deliveryStatus: "QUEUED" });
  })
);

app.get(
  "/api/reports/overview",
  requireAuth,
  requireRole("ADMIN", "EVENT_LEADER"),
  route(async (_req, res) => {
    res.json({
      staffing: await all(
        "select event_name,required_count required,confirmed_count filled from event_staffing_summary order by starts_at"
      ),
      attendance: await all("select status,count(*)::int count from attendance group by status"),
      compliance: await all(
        "select effective_status status,count(*)::int count from volunteer_requirement_status group by effective_status"
      ),
      recentAudit: await all(
        "select al.*,u.email actor_email from audit_logs al left join app_users u on u.id=al.actor_user_id order by occurred_at desc limit 25"
      )
    });
  })
);

app.get(
  "/api/exports/:type.csv",
  requireAuth,
  requireRole("ADMIN"),
  route(async (req, res) => {
    const queries: Record<string, string> = {
      volunteers:
        "select volunteer_id,first_name,middle_name,last_name,application_status,email,phone from volunteer_directory",
      events: "select id,name,starts_at,ends_at,status from events",
      assignments: "select id,event_group_id,volunteer_id,status,created_at from assignments"
    };
    const query = queries[String(req.params.type)];
    if (!query) return void res.status(404).json({ error: "Unknown export type" });
    const rows = await all<Record<string, unknown>>(query);
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    res
      .type("text/csv")
      .send(
        [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n")
      );
  })
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError)
    return res.status(400).json({
      error: "Validation failed",
      reasons: error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`),
      issues: error.issues
    });
  if (error instanceof ApiError) return res.status(error.statusCode).json({ error: error.message });
  if (error instanceof GeocodingError) return res.status(error.statusCode).json({ error: error.message });
  if (["42P01", "42703"].includes(String((error as { code?: string }).code)))
    return res.status(500).json({
      error:
        "Database schema is missing the latest ministry membership request migration. Run supabase/migrations/20260625022_ministry_membership_requests.sql in Supabase."
    });
  if ((error as { code?: string }).code === "23505")
    return res.status(409).json({ error: "This record conflicts with an existing active record" });
  console.error(error);
  res.status(500).json({ error: "Unexpected server error" });
});

export async function closeApp() {
  await pool.end();
}
