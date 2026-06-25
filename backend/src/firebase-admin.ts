import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";

function serviceAccountFromEnvironment() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson?.trim()) return JSON.parse(rawJson);

  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!configuredPath) return undefined;

  const root = resolve(import.meta.dirname, "../..");
  const path = isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function initializeFirebaseAdmin() {
  if (getApps().length) return getApps()[0]!;

  const serviceAccount = serviceAccountFromEnvironment();
  if (!serviceAccount) return initializeApp({ credential: applicationDefault() });

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}
