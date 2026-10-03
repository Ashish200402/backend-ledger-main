# Deploy to Render

This repository includes a Render Blueprint in `render.yaml`. It deploys the
Express app as a free Node web service, seeds the demo reserve idempotently on
startup, and checks `/health` before routing traffic.

## Database

Render does not host this app's MongoDB database. Create a MongoDB Atlas
database with replica-set/transaction support, create a database user with a
strong unique password, and add the Render service's outbound IPs to the Atlas
network access list. For temporary testing only, Atlas allows `0.0.0.0/0`, but
this exposes the database login to connection attempts from the internet; use a
least-privilege database user and a unique password if you choose it.

Set the Render `MONGO_URI` environment variable to the Atlas connection string.
Include `replicaSet` only if Atlas provides it in its connection string. Do not
commit the URI or paste it into source files.

## Create the service

1. Push the project to a GitHub repository.
2. In Render, choose **New** → **Blueprint** and select that repository.
3. Review the `backend-ledger` service and choose **Apply**.
4. When prompted, set `MONGO_URI` to the Atlas URI and `SMTP_PASS` to the Gmail
   App Password for `guptashish529@gmail.com`. Render generates `JWT_SECRET`.
5. Wait for the deploy and confirm the service health check at `/health` reports
   `{"status":"ok","database":"connected"}`.

The service is public. This is a demo ledger with a ₹50,000 demo funding
reserve, not a production financial product. The free Render service can sleep
when idle. Keep Gmail and MongoDB secrets only in Render's environment settings
or the ignored local `.env` file.
