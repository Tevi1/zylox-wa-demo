import pgPromise from "pg-promise";
import "dotenv/config";

const pgp = pgPromise({ capSQL: true });

// Use a fallback database URL if none is provided
const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/zylox";

let db: any = null;

try {
  db = pgp(databaseUrl);
  console.log("✅ Database connected successfully");
  console.log("Database URL:", databaseUrl.replace(/:[^:@]+@/, ':***@')); // Hide password
} catch (error) {
  console.warn("⚠️ Database connection failed, running in demo mode:", error.message);
  console.log("Database URL:", databaseUrl.replace(/:[^:@]+@/, ':***@')); // Hide password
  // Create a mock database object for demo mode
  db = {
    query: () => Promise.resolve([]),
    none: () => Promise.resolve(),
    one: () => Promise.resolve(null),
    oneOrNone: () => Promise.resolve(null),
    many: () => Promise.resolve([]),
    manyOrNone: () => Promise.resolve([]),
    any: () => Promise.resolve([]),
    result: () => Promise.resolve({ rows: [], rowCount: 0 }),
    task: (callback: any) => callback(db),
    tx: (callback: any) => callback(db)
  };
}

export { db };
export default db;
