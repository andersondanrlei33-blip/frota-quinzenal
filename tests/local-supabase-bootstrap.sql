-- Minimal Supabase-owned objects for disposable PostgreSQL migration tests.
-- Do not apply this file to a Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema storage;
create table storage.buckets(
 id text primary key,name text not null,public boolean not null default false,
 file_size_limit bigint,allowed_mime_types text[]
);
