import { get } from "./db.js";

export async function eligibilityFor(volunteerId: string, roleId: string) {
  const readiness = await get<{
    is_ready: boolean;
    application_status: string;
    explicit_eligibility_status?: string;
    unmet_requirement_count: number;
  }>(
    `select is_ready, application_status, explicit_eligibility_status, unmet_requirement_count
     from volunteer_role_readiness where volunteer_id=$1 and role_id=$2`,
    [volunteerId, roleId]
  );
  if (!readiness) return { eligible: false, reasons: ["Volunteer or role not found"] };
  const reasons: string[] = [];
  if (readiness.application_status !== "APPROVED") reasons.push("Volunteer application is not approved");
  if (readiness.unmet_requirement_count > 0)
    reasons.push(`${readiness.unmet_requirement_count} required item(s) are incomplete or expired`);
  if (readiness.explicit_eligibility_status && readiness.explicit_eligibility_status !== "ELIGIBLE") {
    reasons.push(`Eligibility is ${readiness.explicit_eligibility_status.toLowerCase()}`);
  }
  if (!readiness.is_ready && !reasons.length) reasons.push("Volunteer does not meet the role age or eligibility rules");
  return { eligible: readiness.is_ready, reasons };
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
