/* global db */
// Runs once, on first start of an empty MongoDB data volume (docker-entrypoint-initdb.d).
// The administrator (nb_admin) is created by the MONGO_INITDB_ROOT_* variables in docker-compose.yml.
const appDb = db.getSiblingDB("noticeboard");

appDb.createUser({
  user: "noticeboard_app",
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: "noticeboard" }],
});

appDb.createUser({
  user: "noticeboard_ro",
  pwd: process.env.MONGO_RO_PASSWORD,
  roles: [{ role: "read", db: "noticeboard" }],
});
