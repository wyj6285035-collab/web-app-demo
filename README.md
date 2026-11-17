# web-app-demo

Small Node.js web app.

- `npm start` – starts the server on `$PORT` (default 3000)
- `GET /` – landing page
- `GET /health` – health check (200)

## Environment

| Name | Required | Default |
|------|----------|---------|
| `UUID` | yes | – |
| `WSPATH` | no | `/api/ws` |
| `PORT` | no | `3000` |
| `CFSM_SECRET`, `CFSM_URL`, `CFSM_ID` | no | monitoring agent disabled unless set |
