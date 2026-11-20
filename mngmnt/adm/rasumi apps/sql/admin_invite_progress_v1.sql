-- Admin Console > App Users: invitation progress for every open invite (read only, super admin).
--   stage 1 sent · 2 opened · 3 downloaded · 4 installed (likely) · 5 signed up
--   installed (likely) = a Rasumi Apps PC first seen from the download IP within 72 h after the download
create or replace function public.rpc_admin_invite_progress()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
    if not _is_admin_console_superadmin() then raise exception 'Not authorized.'; end if;
    select coalesce(jsonb_agg(x order by x ->> 'username'), '[]'::jsonb) into v from (
      select jsonb_build_object(
        'username', u.username, 'email', u.email,
        'sent_at', (select max(o.sent_at) from invite_outbox o where o.username = u.username and o.kind is distinct from 'welcome'),
        'send_error', (select o.last_error from invite_outbox o where o.username = u.username and o.kind is distinct from 'welcome'
                        and o.sent_at is null order by o.id desc limit 1),
        'opens', coalesce(l.opens, 0), 'last_open_at', l.last_open_at,
        'downloads', coalesce(l.downloads, 0), 'max_downloads', l.max_downloads, 'last_download_at', l.last_download_at,
        'device_ua', l.device_ua, 'bound_at', l.device_bound_at,
        'installed', ins.hostname, 'installed_at', ins.first_seen,
        'signed_up', exists (select 1 from auth.users a where lower(a.email) = lower(u.email) and a.email_confirmed_at is not null),
        'events', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'note', e.note, 'ip', e.ip, 'ua', e.ua, 'at', e.at)
                                             order by e.at), '[]'::jsonb)
                     from (select * from app_invite_link_events e where e.link_id = l.id order by e.at desc limit 30) e)
      ) x
      from users u
      left join lateral (select * from app_invite_links k where k.username = u.username and k.revoked_at is null
                         order by k.created_at desc limit 1) l on true
      left join lateral (select m.hostname, m.first_seen from machine_status m
                          where l.last_download_at is not null and coalesce(l.device_ip, '') <> ''
                            and m.public_ip = l.device_ip
                            and m.first_seen between l.last_download_at - interval '10 minutes' and l.last_download_at + interval '72 hours'
                          order by m.first_seen limit 1) ins on true
      where u.invite_status = 'invited' and u.email is not null
    ) q;
    return v;
end $$;
revoke all on function public.rpc_admin_invite_progress() from public, anon;
grant execute on function public.rpc_admin_invite_progress() to authenticated;
