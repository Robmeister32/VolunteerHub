import twilio from "twilio";

interface TwilioConversationAccess {
  token: string;
  conversationSid: string;
  identity: string;
  displayName: string;
  expiresIn: number;
}

const TOKEN_TTL_SECONDS = 60 * 60;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to use group chat`);
  return value;
}

function statusCode(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : undefined;
}

export async function createTwilioConversationAccess({
  eventGroupId,
  eventName,
  eventGroupName,
  userId,
  displayName
}: {
  eventGroupId: string;
  eventName: string;
  eventGroupName: string;
  userId: string;
  displayName: string;
}): Promise<TwilioConversationAccess> {
  const accountSid = requiredEnvironment("TWILIO_ACCOUNT_SID");
  const apiKeySid = requiredEnvironment("TWILIO_API_KEY_SID");
  const apiKeySecret = requiredEnvironment("TWILIO_API_KEY_SECRET");
  const serviceSid = requiredEnvironment("TWILIO_CONVERSATIONS_SERVICE_SID");
  const client = twilio(apiKeySid, apiKeySecret, { accountSid });
  const conversations = client.conversations.v1.services(serviceSid).conversations;
  const uniqueName = `event-group-${eventGroupId}`;

  let conversation;
  try {
    conversation = await conversations(uniqueName).fetch();
  } catch (error) {
    if (statusCode(error) !== 404) throw error;
    try {
      conversation = await conversations.create({
        uniqueName,
        friendlyName: `${eventName} · ${eventGroupName}`,
        attributes: JSON.stringify({ eventGroupId })
      });
    } catch (createError) {
      // A simultaneous first join may have created the deterministic conversation.
      if (statusCode(createError) !== 409) throw createError;
      conversation = await conversations(uniqueName).fetch();
    }
  }

  const identity = `user-${userId}`;
  const participants = client.conversations.v1.services(serviceSid).conversations(conversation.sid).participants;
  const existingParticipant = (await participants.list({ limit: 1000 })).find(
    (participant) => participant.identity === identity
  );
  if (!existingParticipant) {
    await participants.create({ identity, attributes: JSON.stringify({ displayName }) });
  } else if (existingParticipant.attributes !== JSON.stringify({ displayName })) {
    await participants(existingParticipant.sid).update({ attributes: JSON.stringify({ displayName }) });
  }

  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: TOKEN_TTL_SECONDS
  });
  token.addGrant(new AccessToken.ChatGrant({ serviceSid }));

  return {
    token: token.toJwt(),
    conversationSid: conversation.sid,
    identity,
    displayName,
    expiresIn: TOKEN_TTL_SECONDS
  };
}
