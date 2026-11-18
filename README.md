# Livelihood Supply & Gatepass

A role-based stock request and gatepass app backed by Supabase Auth, Postgres, Row Level Security, and Realtime.

## Set up Supabase

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase-schema.sql`](./supabase-schema.sql) once. It creates the profile trigger, request and gatepass tables, role policies, and Realtime publication entries.
3. In **Project Settings → API**, copy the project URL and the publishable key (or legacy anon key). Never use a `service_role` or secret key in this browser app.
4. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. In Supabase Auth, configure the allowed site URL/redirect URLs for where you will host the app. Email confirmation may be enabled or disabled to suit your project.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `.env` is ignored by git.

## Approve a signup and assign a role

Anyone can create an account, but new profiles have no role and cannot open the workspace until an administrator assigns one. After the person signs up, run this in the Supabase SQL Editor, replacing the email and role:

```sql
update public.profiles
set role = 'A'
where email = 'section.leader@example.com';
```

Role values: `A` = Section Leader, `B` = Stock Requisition, `C` = Gatepass Verifier, `D` = Guard. Share the role assignment only with a trusted administrator; users cannot change their own roles.

## Workflow

- **A - Section Leader:** type the requested item, quantity, and unit; B confirms availability. A can also submit a gatepass with the item and destination.
- **B - Stock Requisition:** sees all stock requests and confirms or marks each unavailable after checking the stock room.
- **C - Gatepass Verifier:** verifies or rejects submitted gatepasses.
- **D - Guard:** sees verified gatepasses only.

The signed-in user's name and assigned role appear at the bottom of the sidebar. Changes are stored in Supabase and shared across signed-in users; live updates use Supabase Realtime. RLS policies enforce role access in the database, not just in the UI.
