-- Deletes this agent's commands older than 7 days and runs older than 60 days.
-- The Mac agent calls it about once a day. NOT YET APPLIED to the Budget project.
create or replace function claudehub.agent_cleanup(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent claudehub.agents := claudehub.agent_auth(p_token);
begin
  delete from claudehub.commands where agent_id = v_agent.id and created_at < now() - interval '7 days';
  delete from claudehub.jobs where agent_id = v_agent.id and updated_at < now() - interval '60 days';
end;
$$;
revoke all on function claudehub.agent_cleanup(text) from public;
grant execute on function claudehub.agent_cleanup(text) to anon, authenticated;
