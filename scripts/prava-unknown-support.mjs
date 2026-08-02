import postgres from "postgres";

import { loadProjectEnvironment } from "./project-env.mjs";

const publicId = process.argv.find((argument) =>
  /^RB-[A-F0-9]{8}$/.test(argument),
);
const includePrivateReference = process.argv.includes("--include-private-ref");

if (!publicId) {
  console.error(
    "Usage: npm run inspect:prava-session -- RB-XXXXXXXX [--include-private-ref]",
  );
  process.exit(64);
}

const { environment } = loadProjectEnvironment({ projectDir: process.cwd() });
const sql = postgres(environment.DATABASE_URL, {
  prepare: false,
  ssl:
    environment.DATABASE_SSL === "disable"
      ? false
      : (environment.DATABASE_SSL ?? "require"),
});

try {
  const [operation] = await sql`
    SELECT r.public_id, r.state, o.status, o.created_at, o.updated_at, o.http_status,
           o.vendor_code, o.transport_code,
           o.response_id IS NOT NULL AS has_response_id,
           o.idempotency_key
    FROM relaybuy_live_requests r
    JOIN relaybuy_prava_session_operations o ON o.request_id = r.id
    WHERE r.public_id = ${publicId}
  `;

  if (!operation) {
    console.error("No Prava session operation exists for that public request.");
    process.exitCode = 1;
  } else if (operation.status !== "unknown") {
    console.error(
      `The Prava session operation is ${operation.status}, not unknown.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          privateSupportBundle: includePrivateReference,
          publicRequestId: operation.public_id,
          state: operation.state,
          operation: "create_session",
          operationStatus: operation.status,
          operationStartedAt: operation.created_at.toISOString(),
          operationUpdatedAt: operation.updated_at.toISOString(),
          httpStatus: operation.http_status,
          hasResponseId: operation.has_response_id,
          vendorCode: operation.vendor_code,
          transportCode: operation.transport_code,
          externalOrderRef: includePrivateReference
            ? operation.idempotency_key
            : "[PRIVATE: rerun with --include-private-ref only for Prava support]",
        },
        null,
        2,
      ),
    );
  }
} finally {
  await sql.end();
}
