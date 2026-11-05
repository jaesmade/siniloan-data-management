import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root=fileURLToPath(new URL("..",import.meta.url));
const env=Object.fromEntries(readFileSync(join(root,".env.local"),"utf8").split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const i=line.indexOf("=");return [line.slice(0,i),line.slice(i+1).trim()];}));
const url=env.NEXT_PUBLIC_SUPABASE_URL;const service=env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!service||!["localhost","127.0.0.1"].includes(new URL(url).hostname))throw new Error("Role fixtures only run against local Supabase in .env.local.");
const docker=join(process.env.LOCALAPPDATA??"","Programs","DockerDesktop","resources","bin","docker.exe");
function query(sql){return execFileSync(docker,["exec","supabase_db_siniloan-enterprise-data","psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-Atc",sql],{encoding:"utf8"}).trim();}
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const definitions=[
 {username:"systemadmin",email:"systemadmin@siniloan.invalid",name:"Local System Administrator",role:"system_admin",department:"DPO"},
 {username:"dpo",email:"dpo@siniloan.invalid",name:"Local Data Privacy Officer",role:"dpo",department:"DPO"},
 {username:"focal",email:"focal@siniloan.invalid",name:"Local Office Focalperson",role:"office_focal",department:"PESO"},
 {username:"staff",email:"staff@siniloan.invalid",name:"Local Staff",role:"staff",department:"PESO"},
];
const accounts=[];
for(const item of definitions){
 const password=randomBytes(24).toString("base64url");
 let user=null;
 for(let page=1;page<=20&&!user;page++){const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});if(error)throw error;user=data.users.find(candidate=>candidate.email?.toLowerCase()===item.email)??null;if(data.users.length<1000)break;}
 if(user){const {data,error}=await admin.auth.admin.updateUserById(user.id,{password,email_confirm:true,user_metadata:{full_name:item.name,username:item.username}});if(error)throw error;user=data.user;}
 else {const {data,error}=await admin.auth.admin.createUser({email:item.email,password,email_confirm:true,user_metadata:{full_name:item.name,username:item.username}});if(error||!data.user)throw error??new Error("Auth user creation failed.");user=data.user;}
 const department=query(`select id from core.departments where code='${item.department}' and is_active limit 1`);
 if(!department)throw new Error(`Missing local test department ${item.department}.`);
 const escapedId=user.id;
 query(`begin; update core.profiles set full_name='${item.name}',username='${item.username}',role='${item.role}',status='active',department_id='${department}',requested_department_id='${department}',approved_at=coalesce(approved_at,now()),updated_at=now() where id='${escapedId}'; commit;`);
 accounts.push({...item,id:user.id,password});
}
const systemAdmin=accounts.find(item=>item.role==="system_admin");const focal=accounts.find(item=>item.role==="office_focal");
query(`begin; update core.user_dataset_grants set revoked_at=now() where user_id='${focal.id}' and revoked_at is null; insert into core.user_dataset_grants(user_id,dataset_id,access_mode,department_scope_id,granted_by) select '${focal.id}',id,'read_write',null,'${systemAdmin.id}' from core.datasets where is_active; commit;`);
query(`insert into core.audit_events(actor_id,action,target_type,target_id,summary,metadata) values('${systemAdmin.id}','account.local_test_fixtures','profile','local-test-roles','Local role testing accounts provisioned','{"source":"local_bootstrap"}')`);
for(const item of accounts)console.log(`${item.role}\t${item.username}\t${item.password}`);
