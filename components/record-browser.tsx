"use client";

import { useEffect, useState } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { AddRecordModal, type EditableRecord } from '@/components/add-record-modal';
import { RecordDetailModal } from '@/components/record-detail-modal';
import { createClient } from '@/lib/supabase/client';
import type { DatabaseKey } from './app-shared';

type Row = { id: string; [key: string]: unknown };
type Result = { rows: Row[]; total: number; page: number; statuses: string[] };
export function RecordBrowser({ database, columns, prepare, display, canEdit = false, onUpdated, refreshKey = 0 }: {
  database: DatabaseKey; columns: Array<[string,string]>;
  prepare: (database: DatabaseKey, rows: Row[]) => Row[];
  display: (value: unknown) => string;
  canEdit?: boolean;
  onUpdated?: (message: string) => void;
  refreshKey?: number;
}) {
  const [filters,setFilters]=useState({search:'',status:'',secondary:'',from:'',to:'',sort:'created_at',desc:true,page:1,size:25,requestType:''});
  const [result,setResult]=useState<Result|null>(null);
  const [loadedKey,setLoadedKey]=useState('');
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [editing,setEditing]=useState<EditableRecord|null>(null);
  const [viewing,setViewing]=useState<Row|null>(null);
  const key=JSON.stringify(filters);
  const invalid=Boolean(filters.from && filters.to && filters.from>filters.to);
  const busy=loadedKey!==key;
  const primary=database==='tupad'?'Beneficiary type':'Request status';
  const secondary=database==='tupad'?'Barangay':'Category';
  const requestTypes=[['','All requests'],['data_request','Data requests'],['interview_request','Interview requests']] as const;
  function update(changes: Partial<typeof filters>) { setFilters(current=>({...current,...changes,page:1})); }
  useEffect(()=>{
    if(invalid)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try {
        const {data,error}=await createClient().schema('core').rpc('query_records',{
          p_module:database,p_search:filters.search,p_status:filters.status,p_secondary:filters.secondary,
          p_from:filters.from||null,p_to:filters.to||null,p_sort:filters.sort,p_desc:filters.desc,p_page:filters.page,p_size:filters.size,p_request_type:filters.requestType,
        }).abortSignal(controller.signal);
        if(controller.signal.aborted)return;
        if(error)throw error;
        setResult(data as Result);setError('');setLoadedKey(key);
      } catch {
        if(!controller.signal.aborted){setError('Records could not be loaded. Please retry.');setLoadedKey(key);}
      }
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[database,filters,key,invalid,retry,refreshKey]);
  const page=result?.page??1;
  const total=result?.total??0;
  const pages=Math.max(1,Math.ceil(total/filters.size));
  const hasOtherFilters=Boolean(filters.search||filters.status||filters.secondary||filters.from||filters.to);
  return <><section className="panel table-panel" aria-label="Database records">
    {database==='research'&&<div className="tabs record-request-tabs" role="group" aria-label="Request type">
      {requestTypes.map(([value,label])=><button key={value} type="button" aria-pressed={filters.requestType===value} className={filters.requestType===value?'active':''} onClick={()=>update({requestType:value})}>{label}</button>)}
    </div>}
    <div className="record-filter-grid">
      <label>Search records<input maxLength={200} value={filters.search} onChange={e=>update({search:e.target.value})} placeholder="Search all accessible records"/></label>
      <label>{primary}<select value={filters.status} onChange={e=>update({status:e.target.value})}><option value="">{database==='tupad'?'All types':'All statuses'}</option>{result?.statuses.map(status=><option key={status} value={status}>{display(status)}</option>)}</select></label>
      <label>{secondary}<input maxLength={200} value={filters.secondary} onChange={e=>update({secondary:e.target.value})}/></label>
      <><label>{database==='tupad'?'Birth date from':'Received from'}<input type="date" value={filters.from} onChange={e=>update({from:e.target.value})}/></label><label>Date to<input type="date" value={filters.to} onChange={e=>update({to:e.target.value})}/></label></>
      <label>Sort by<select value={filters.sort} onChange={e=>update({sort:e.target.value})}><option value="created_at">Date added</option><option value="name">Name</option><option value="status">{primary}</option><option value="secondary">{secondary}</option><option value="control_number">{database==='tupad'?'Source number':'Control number'}</option><option value="record_date">{database==='tupad'?'Birth date':'Received date'}</option></select></label>
      <label>Order<select value={String(filters.desc)} onChange={e=>update({desc:e.target.value==='true'})}><option value="false">Ascending</option><option value="true">Descending</option></select></label>
      <label>Rows per page<select value={filters.size} onChange={e=>update({size:Number(e.target.value)})}>{[25,50,100].map(size=><option key={size}>{size}</option>)}</select></label>
      <div className="record-filter-actions"><button className="button secondary" onClick={()=>update({search:'',status:'',secondary:'',from:'',to:'',requestType:''})}>Clear filters</button><span>Filters search all records you can access.</span></div>
    </div>
    {invalid?<p className="empty-state" role="alert">Date to must be on or after Date from.</p>:busy?<div className="empty-state" role="status">Loading records…</div>:error?<div className="empty-state" role="alert"><p>{error}</p><button className="button secondary" onClick={()=>{setLoadedKey('');setRetry(value=>value+1);}}>Retry</button></div>:<>
      {total===0?<div className="empty-state"><h2>{filters.requestType==='interview_request'?'No matching interview requests':filters.requestType==='data_request'?'No matching data requests':'No matching records'}</h2><p>{hasOtherFilters?'Change or clear your filters to see more records.':filters.requestType==='interview_request'?'Interview requests will appear here when submitted or imported.':filters.requestType==='data_request'?'Data requests will appear here when submitted or imported.':database==='tupad'?'Beneficiaries will appear here after a workbook is imported.':'Records will appear here when added.'}</p></div>:<div className="table-scroll"><table><thead><tr>{columns.map(([field,label])=><th key={field}>{label}</th>)}<th>Actions</th></tr></thead><tbody>{prepare(database,result?.rows??[]).map(row=><tr key={row.id} className="record-data-row" onClick={()=>setViewing(row)}>{columns.map(([field],index)=><td key={field}>{index===0?<button type="button" className="record-view-link" onClick={()=>setViewing(row)} aria-label={`View full record for ${display(row[field])}`}>{display(row[field])}</button>:display(row[field])}</td>)}<td className="record-actions"><button type="button" className="button secondary record-edit-button" onClick={event=>{event.stopPropagation();setViewing(row);}} aria-label={`View ${database} record ${row.id}`}>View</button>{canEdit&&database==='research'&&!row.archived_at&&<button type="button" className="button secondary record-edit-button" onClick={event=>{event.stopPropagation();setEditing(row);}} aria-label={`Edit ${database} record ${row.id}`}><PencilSimple/> Edit</button>}</td></tr>)}</tbody></table></div>}
      <div className="pagination"><span role="status">{total===0?'0 matching records':`Showing ${((page-1)*filters.size+1).toLocaleString()}–${Math.min(page*filters.size,total).toLocaleString()} of ${total.toLocaleString()} matching records`}</span><div><button aria-label="First page" disabled={page<=1} onClick={()=>setFilters(current=>({...current,page:1}))}>«</button><button aria-label="Previous page" disabled={page<=1} onClick={()=>setFilters(current=>({...current,page:page-1}))}>‹</button><span>Page {page} of {pages}</span><button aria-label="Next page" disabled={page>=pages} onClick={()=>setFilters(current=>({...current,page:page+1}))}>›</button><button aria-label="Last page" disabled={page>=pages} onClick={()=>setFilters(current=>({...current,page:pages}))}>»</button></div></div>
    </>}
  </section>{viewing&&<RecordDetailModal database={database} record={viewing} canDelete={canEdit} onDeleted={()=>{onUpdated?.("Record permanently deleted.");setRetry(value=>value+1);}} onClose={()=>setViewing(null)} onEdit={canEdit&&database==='research'&&!viewing.archived_at?()=>{setEditing(viewing);setViewing(null);}:undefined}/>}{editing&&database==='research'&&<AddRecordModal database={database} record={editing} onClose={()=>setEditing(null)} onSaved={(message)=>{setEditing(null);onUpdated?.(message);setRetry(value=>value+1);}}/>}</>;
}
