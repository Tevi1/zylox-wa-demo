import pgPromise from "pg-promise";
import "dotenv/config";
const pgp = pgPromise({ capSQL: true });
export const db = pgp(process.env.DATABASE_URL!);
export default db;
