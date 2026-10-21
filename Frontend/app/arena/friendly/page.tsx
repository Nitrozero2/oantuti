"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
type Agent={id:number;agent_name:string;username:string;can_use?:boolean;is_mine?:boolean};
type Match={id:number;status:string;agent1_name:string;agent2_name:string;pending_backend:boolean;winner_name:string|null;outcome:string|null;created_at:string};
type Quota={used:number;remaining:number;limit:number;resets_at:string};
export default function PrivateTrials(){
 const [agents,setAgents]=useState<Agent[]>([]),[matches,setMatches]=useState<Match[]>([]),[quota,setQuota]=useState<Quota|null>(null);
 const [own,setOwn]=useState(''),[opponent,setOpponent]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(1);
 const requestId=useRef<string|null>(null);
 const refresh=useCallback(async()=>{try{const r=await fetch(`/api/friendly?page=${page}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);setMatches(d.matches);setQuota(d.quota);}catch(e){setMessage(e instanceof Error?e.message:'Không thể tải dữ liệu.');}},[page]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[refresh]);
 useEffect(()=>{fetch('/api/arena/agents/all-active').then(r=>r.json()).then(d=>setAgents(d.agents??[])).catch(()=>setMessage('Không tải được agent.'));},[]);
 const mine=agents.filter(a=>a.can_use??a.is_mine),others=agents.filter(a=>!(a.can_use??a.is_mine));
 async function create(){setBusy(true);setMessage('');requestId.current??=crypto.randomUUID();try{
 const r=await fetch('/api/friendly',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent1_id:Number(own),agent2_id:Number(opponent),request_id:requestId.current})});
 const d=await r.json();if(!r.ok){if(r.status<500)requestId.current=null;throw Error(d.error);}
 requestId.current=null;setMessage(d.message);await refresh();
 }catch(e){setMessage(e instanceof Error?e.message:'Lỗi kết nối. Có thể gửi lại mà không mất thêm lượt.');}finally{setBusy(false);}}
 async function retry(id:number){setBusy(true);try{const r=await fetch('/api/friendly/process-pending',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({match_id:id})});const d=await r.json();setMessage(r.ok?(d.queued?'Đã gửi vào queue.':'Backend chưa sẵn sàng; trận vẫn được giữ.'):d.error);await refresh();}catch{setMessage('Không thể kết nối.');}finally{setBusy(false);}}
 return <><Navbar/><main className="mx-auto max-w-6xl p-6"><h1 className="text-3xl font-bold">Thách đấu riêng tư</h1>
 <p className="my-4 text-slate-600">Thử agent cá nhân/team với agent public của người khác. Không gửi thách đấu, không thông báo đối thủ và không ảnh hưởng rating. Chỉ bạn hoặc thành viên hiện tại của team nguồn được xem lịch sử/replay (admin có quyền kỹ thuật).</p>
 <p className="mb-4">{quota?`Đã dùng ${quota.used}/${quota.limit} lượt · còn ${quota.remaining}. Đặt lại lúc ${new Date(quota.resets_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} (giờ Việt Nam).`:'Đang tải hạn mức…'}</p>
 <section className="grid gap-4 border bg-white p-5 md:grid-cols-2"><label>Agent của cá nhân/team<select aria-label="Agent của bạn" className="mt-2 w-full border p-3" value={own} onChange={e=>{setOwn(e.target.value);requestId.current=null;}}><option value="">Chọn agent</option>{mine.map(a=><option key={a.id} value={a.id}>{a.agent_name}</option>)}</select></label>
 <label>Đối thủ public<select aria-label="Đối thủ public" className="mt-2 w-full border p-3" value={opponent} onChange={e=>{setOpponent(e.target.value);requestId.current=null;}}><option value="">Chọn đối thủ</option>{others.map(a=><option key={a.id} value={a.id}>{a.username} · {a.agent_name}</option>)}</select></label>
 <p className="text-sm text-slate-500">Agent phải vượt self-play và đang hoạt động. Máy chủ chọn bên đi trước ngẫu nhiên 50/50. Lỗi hạ tầng hoặc hủy trước khi chạy được hoàn lượt; lỗi do agent vẫn tính lượt.</p>
 <button className="bg-[#253B80] p-3 text-white disabled:opacity-50" disabled={busy||!own||!opponent||quota?.remaining===0} onClick={create}>{busy?'Đang xử lý…':'Tạo một trận thách đấu'}</button></section>
 {message&&<p role="alert" className="my-4 border p-3">{message}</p>}
 <section className="mt-8"><h2 className="text-xl font-bold">Lịch sử thách đấu riêng</h2>{matches.map(m=><article key={m.id} className="my-3 flex flex-wrap items-center justify-between gap-3 border bg-white p-4"><div>#{m.id} · {m.agent1_name} vs {m.agent2_name}<p className="text-sm text-slate-500">{m.status} · {m.winner_name?`Thắng: ${m.winner_name}`:m.outcome??'Chờ kết quả'}</p></div><div className="flex gap-4"><Link className="text-blue-700 underline" href={`/arena/replay/friendly/${m.id}`}>Replay</Link>{m.pending_backend&&m.status==='scheduled'&&<button disabled={busy} onClick={()=>retry(m.id)}>Gửi lại vào queue</button>}</div></article>)}{!matches.length&&<p className="py-4">Chưa có trận thách đấu.</p>}
 <div className="flex items-center gap-4"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Trước</button><span>Trang {page}</span><button disabled={matches.length<20} onClick={()=>setPage(p=>p+1)}>Sau</button><button onClick={()=>void refresh()}>Làm mới</button></div></section></main></>;
}
