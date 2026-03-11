import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie, LabelList } from "recharts";
import { db } from "./firebase";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  setDoc, getDoc, query, orderBy, limit, serverTimestamp
} from "firebase/firestore";

const EMPTY_FORM = { name: "", type: "政收", status: "爭取中", taxAmount: "", noTaxAmount: "", profitRate: "" };

function fmt(n) {
  if (n == null || n === "" || isNaN(n)) return "—";
  return Number(n).toLocaleString("zh-TW");
}
function surplus(item) {
  const r = parseFloat(item.profitRate), a = parseFloat(item.noTaxAmount);
  if (isNaN(r) || isNaN(a)) return null;
  return a * (r / 100);
}
function assignCodes(data) {
  let a = 0, b = 0;
  return data.map(d => ({ ...d, code: d.type === "政收" ? `A${++a}` : `B${++b}` }));
}

async function getSetting(key) {
  try {
    const snap = await getDoc(doc(db, "settings", key));
    return snap.exists() ? snap.data().value : null;
  } catch { return null; }
}
async function setSetting(key, value) {
  try { await setDoc(doc(db, "settings", key), { value: String(value) }); } catch {}
}

const TAG_STYLES = {
  "政收": { bg: "#dbeafe", color: "#1d4ed8" },
  "民收": { bg: "#d1fae5", color: "#065f46" },
};
const STATUS_STYLES = {
  "已簽約": { bg: "#bbf7d0", color: "#065f46" },
  "爭取中": { bg: "#fef3c7", color: "#92400e" },
};
const GROUP_COLORS = ["#1d4ed8","#60a5fa","#059669","#f59e0b"];
const GROUP_KEYS = ["政收-已簽約","政收-爭取中","民收-已簽約","民收-爭取中"];

export default function App() {
  const [data, setData] = useState([]);
  const [logs, setLogs] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [filterType, setFilterType] = useState("全部");
  const [filterStatus, setFilterStatus] = useState("全部");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [viewMode, setViewMode] = useState("table");
  const [govTargetInput, setGovTargetInput] = useState("");
  const [civTargetInput, setCivTargetInput] = useState("");
  const [editingGovTarget, setEditingGovTarget] = useState(false);
  const [editingCivTarget, setEditingCivTarget] = useState(false);
  const [dbReady, setDbReady] = useState(false);

  // 初始載入 — 全部並行，不再序列等待
  useEffect(() => {
    (async () => {
      const [casesSnap, logsSnap, govTgt, civTgt] = await Promise.all([
        getDocs(query(collection(db, "cases"), orderBy("createdAt"))),
        getDocs(query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(200))),
        getSetting("govTarget"),
        getSetting("civTarget"),
      ]);

      setData(casesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLogs(logsSnap.docs.map(d => {
        const r = d.data();
        return { id: d.id, time: r.createdAt?.toDate().toLocaleString("zh-TW") ?? "", action: r.action, name: r.caseName, detail: r.detail };
      }));
      if (govTgt) setGovTargetInput(govTgt);
      if (civTgt) setCivTargetInput(civTgt);
      setDbReady(true);
    })();
  }, []);

  // 目標金額 — debounce 1 秒後才寫入，避免每打一個字就寫一次
  useEffect(() => {
    if (!dbReady) return;
    const t = setTimeout(() => setSetting("govTarget", govTargetInput), 1000);
    return () => clearTimeout(t);
  }, [govTargetInput, dbReady]);
  useEffect(() => {
    if (!dbReady) return;
    const t = setTimeout(() => setSetting("civTarget", civTargetInput), 1000);
    return () => clearTimeout(t);
  }, [civTargetInput, dbReady]);

  const dataWithCodes = assignCodes(data);

  // addLog — fire and forget，不 await，不阻塞 UI
  const addLog = (action, item) => {
    const detail = `${item.type} | ${item.status} | 未稅: ${fmt(item.noTaxAmount)}仟元 | 利潤率: ${item.profitRate}%`;
    addDoc(collection(db, "logs"), { action, caseName: item.name, detail, createdAt: serverTimestamp() })
      .then(ref => setLogs(prev => [{
        id: ref.id, time: new Date().toLocaleString("zh-TW"), action, name: item.name, detail
      }, ...prev].slice(0, 200)));
  };

  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setShowModal(true); };
  const openEdit = (item) => {
    setForm({ ...item, taxAmount: item.taxAmount ?? "", noTaxAmount: item.noTaxAmount ?? "", profitRate: item.profitRate ?? "" });
    setEditId(item.id); setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.noTaxAmount) return alert("請填寫案名與未稅金額");
    const item = {
      ...form,
      taxAmount: form.taxAmount === "" ? null : parseFloat(form.taxAmount),
      noTaxAmount: parseFloat(form.noTaxAmount),
      profitRate: parseFloat(form.profitRate) || 0,
    };

    // Optimistic UI — 先關 modal、先更新畫面，再背景寫入 Firebase
    if (editId != null) {
      setData(prev => prev.map(d => d.id === editId ? { ...item, id: editId } : d));
      setShowModal(false);
      addLog("修改", item);
      const { id, code, ...fields } = item;
      updateDoc(doc(db, "cases", editId), fields);
    } else {
      const tempId = `temp_${Date.now()}`;
      setData(prev => [...prev, { ...item, id: tempId }]);
      setShowModal(false);
      addLog("新增", item);
      addDoc(collection(db, "cases"), { ...item, createdAt: serverTimestamp() })
        .then(ref => setData(prev => prev.map(d => d.id === tempId ? { ...item, id: ref.id } : d)));
    }
  };

  const handleDelete = async (item) => {
    // Optimistic UI — 先從畫面移除，再背景刪除
    setData(prev => prev.filter(d => d.id !== item.id));
    setDeleteConfirm(null);
    addLog("刪除", item);
    deleteDoc(doc(db, "cases", item.id));
  };

  const filtered = dataWithCodes.filter(d =>
    (filterType === "全部" || d.type === filterType) &&
    (filterStatus === "全部" || d.status === filterStatus)
  );

  const totalNoTax = data.reduce((s, d) => s + d.noTaxAmount, 0);
  const totalSurplus = data.reduce((s, d) => s + (surplus(d) || 0), 0);
  const signedAmt = data.filter(d => d.status === "已簽約").reduce((s, d) => s + d.noTaxAmount, 0);
  const pursuingAmt = data.filter(d => d.status === "爭取中").reduce((s, d) => s + d.noTaxAmount, 0);

  const groupBarData = GROUP_KEYS.map((k, i) => {
    const [type, status] = k.split("-");
    const amt = data.filter(d => d.type === type && d.status === status).reduce((s, d) => s + d.noTaxAmount, 0);
    const typeTarget = type === "政收" ? (parseFloat(govTargetInput) || 0) : (parseFloat(civTargetInput) || 0);
    return { group: k, 爭取金額: amt, 目標金額: typeTarget, fill: GROUP_COLORS[i] };
  });

  return (
    <div style={{ fontFamily: "'Noto Sans TC','Microsoft JhengHei',sans-serif", background: "#f0f4f8", minHeight: "100vh" }}>

    {/* 載入中遮罩 */}
    {!dbReady && (
      <div style={{ position:"fixed", inset:0, background:"#f0f4f8", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:999 }}>
        <div style={{ fontSize:36, marginBottom:12 }}>📊</div>
        <div style={{ fontSize:16, fontWeight:700, color:"#1e3a5f", marginBottom:6 }}>財務分析系統</div>
        <div style={{ fontSize:13, color:"#94a3b8" }}>載入資料中...</div>
        <div style={{ marginTop:16, width:120, height:4, background:"#e2e8f0", borderRadius:4, overflow:"hidden" }}>
          <div style={{ width:"60%", height:"100%", background:"#3b82f6", borderRadius:4, animation:"none" }} />
        </div>
      </div>
    )}

      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg,#1e3a5f,#0f2744)", color: "#fff", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 4px 20px rgba(0,0,0,0.25)", position: "sticky", top: 0, zIndex: 100 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>📊 財務分析系統</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Finance Dashboard · 金額單位：仟元</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowLog(true)} style={btn("#334155")}>📋 操作記錄</button>
          <button onClick={openAdd} style={btn("#2563eb")}>＋ 新增案件</button>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 12, padding: "16px 20px 0" }}>

        {/* 政收A 卡片 */}
        {(() => {
          const govData = data.filter(d => d.type === "政收");
          const govSigned = govData.filter(d => d.status === "已簽約").reduce((s, d) => s + d.noTaxAmount, 0);
          const govTotal  = govData.reduce((s, d) => s + d.noTaxAmount, 0);
          const govTarget = parseFloat(govTargetInput) || 0;
          const pct = govTarget > 0 ? Math.round(govSigned / govTarget * 100) : 0;
          return (
            <div style={{ background: "#fff", borderRadius: 12, padding: "13px 15px", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", borderTop: "4px solid #1d4ed8" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8" }}>政收 A</span>
                <span style={{ fontSize: 11, background: "#dbeafe", color: "#1d4ed8", borderRadius: 6, padding: "1px 7px", fontWeight: 700 }}>{govData.length} 件</span>
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>目標金額 <span style={{ color: "#bfdbfe", fontSize: 9 }}>（點擊編輯）</span></div>
                  {editingGovTarget ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        autoFocus
                        type="number"
                        value={govTargetInput}
                        onChange={e => setGovTargetInput(e.target.value)}
                        onBlur={() => setEditingGovTarget(false)}
                        onKeyDown={e => e.key === "Enter" && setEditingGovTarget(false)}
                        style={{ width: "80px", fontSize: 13, fontWeight: 700, border: "1.5px solid #3b82f6", borderRadius: 6, padding: "2px 5px", color: "#1e3a5f", outline: "none" }}
                      />
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>仟</span>
                    </div>
                  ) : (
                    <div onClick={() => setEditingGovTarget(true)} style={{ fontSize: 13, fontWeight: 700, color: "#1e3a5f", marginTop: 1, cursor: "pointer", borderBottom: "1.5px dashed #bfdbfe", display: "inline-block" }}>
                      {govTargetInput ? fmt(parseFloat(govTargetInput)) : "—"}<span style={{ fontSize: 10, marginLeft: 2 }}>仟</span>
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>爭取金額</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", marginTop: 1 }}>{fmt(govTotal)}<span style={{ fontSize: 10, marginLeft: 2 }}>仟</span></div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>已簽約</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981", marginTop: 1 }}>{fmt(govSigned)}<span style={{ fontSize: 10, marginLeft: 2 }}>仟</span></div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>達成率</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444", marginTop: 1 }}>{govTarget > 0 ? `${pct}%` : "—"}</div>
                </div>
              </div>
              <div style={{ marginTop: 8, background: "#f1f5f9", borderRadius: 6, height: 6, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(pct, 100)}%`, background: "#1d4ed8", height: "100%", borderRadius: 6, transition: "width 0.6s" }} />
              </div>
            </div>
          );
        })()}

        {/* 民收B 卡片 */}
        {(() => {
          const civData = data.filter(d => d.type === "民收");
          const civSigned = civData.filter(d => d.status === "已簽約").reduce((s, d) => s + d.noTaxAmount, 0);
          const civTotal  = civData.reduce((s, d) => s + d.noTaxAmount, 0);
          const civTarget = parseFloat(civTargetInput) || 0;
          const pct = civTarget > 0 ? Math.round(civSigned / civTarget * 100) : 0;
          return (
            <div style={{ background: "#fff", borderRadius: 12, padding: "13px 15px", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", borderTop: "4px solid #059669" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>民收 B</span>
                <span style={{ fontSize: 11, background: "#d1fae5", color: "#065f46", borderRadius: 6, padding: "1px 7px", fontWeight: 700 }}>{civData.length} 件</span>
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>目標金額 <span style={{ color: "#a7f3d0", fontSize: 9 }}>（點擊編輯）</span></div>
                  {editingCivTarget ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        autoFocus
                        type="number"
                        value={civTargetInput}
                        onChange={e => setCivTargetInput(e.target.value)}
                        onBlur={() => setEditingCivTarget(false)}
                        onKeyDown={e => e.key === "Enter" && setEditingCivTarget(false)}
                        style={{ width: "80px", fontSize: 13, fontWeight: 700, border: "1.5px solid #059669", borderRadius: 6, padding: "2px 5px", color: "#1e3a5f", outline: "none" }}
                      />
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>仟</span>
                    </div>
                  ) : (
                    <div onClick={() => setEditingCivTarget(true)} style={{ fontSize: 13, fontWeight: 700, color: "#1e3a5f", marginTop: 1, cursor: "pointer", borderBottom: "1.5px dashed #a7f3d0", display: "inline-block" }}>
                      {civTargetInput ? fmt(parseFloat(civTargetInput)) : "—"}<span style={{ fontSize: 10, marginLeft: 2 }}>仟</span>
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>爭取金額</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#059669", marginTop: 1 }}>{fmt(civTotal)}<span style={{ fontSize: 10, marginLeft: 2 }}>仟</span></div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>已簽約</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981", marginTop: 1 }}>{fmt(civSigned)}<span style={{ fontSize: 10, marginLeft: 2 }}>仟</span></div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>達成率</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444", marginTop: 1 }}>{civTarget > 0 ? `${pct}%` : "—"}</div>
                </div>
              </div>
              <div style={{ marginTop: 8, background: "#f1f5f9", borderRadius: 6, height: 6, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(pct, 100)}%`, background: "#059669", height: "100%", borderRadius: 6, transition: "width 0.6s" }} />
              </div>
            </div>
          );
        })()}

        {/* 預估總餘絀 */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "13px 15px", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", borderTop: "4px solid #8b5cf6" }}>
          <div style={{ fontSize: 20 }}>📈</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>預估總餘絀</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#8b5cf6", marginTop: 2 }}>{fmt(Math.round(totalSurplus))} 仟</div>
        </div>
      </div>

      {/* FILTER */}
      <div style={{ padding: "13px 20px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#475569", fontWeight: 600 }}>篩選：</span>
        {["全部","政收","民收"].map(t => (
          <button key={t} onClick={() => setFilterType(t)} style={fbtn(filterType === t)}>{t}</button>
        ))}
        <span style={{ color: "#cbd5e1" }}>|</span>
        {["全部","已簽約","爭取中"].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={fbtn(filterStatus === s)}>{s}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8", marginRight: 8 }}>共 {filtered.length} 筆</span>
        {/* 檢視切換 */}
        <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 3, gap: 2 }}>
          <button onClick={() => setViewMode("table")} style={{ border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 13, background: viewMode === "table" ? "#1e3a5f" : "transparent", color: viewMode === "table" ? "#fff" : "#64748b", transition: "all 0.15s" }}>☰ 表格</button>
          <button onClick={() => setViewMode("card")}  style={{ border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 13, background: viewMode === "card"  ? "#1e3a5f" : "transparent", color: viewMode === "card"  ? "#fff" : "#64748b", transition: "all 0.15s" }}>⊞ 卡片</button>
        </div>
      </div>

      {/* TABLE VIEW */}
      {viewMode === "table" && (
      <div style={{ margin: "0 20px 20px", borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.09)", background: "#fff" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "linear-gradient(90deg,#1e3a5f,#1e4976)", color: "#fff", position: "sticky", top: 52 }}>
                {["類型","狀態","案名","含稅金額 (仟元)","未稅金額 (仟元)","利潤率 (%)","預估餘絀 (仟元)","操作"].map(h => (
                  <th key={h} style={{ padding: "12px 11px", textAlign: h==="操作"?"center":"left", whiteSpace: "nowrap", fontWeight: 600, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const s = surplus(item);
                return (
                  <tr key={item.id}
                    style={{ background: idx%2===0?"#f8fafc":"#fff", transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background="#e0f2fe"}
                    onMouseLeave={e => e.currentTarget.style.background=idx%2===0?"#f8fafc":"#fff"}
                  >
                    <td style={{ padding: "11px 11px" }}>
                      <span style={{ ...tg, background: TAG_STYLES[item.type].bg, color: TAG_STYLES[item.type].color }}>{item.type}</span>
                    </td>
                    <td style={{ padding: "11px 11px" }}>
                      <span style={{ ...tg, background: STATUS_STYLES[item.status].bg, color: STATUS_STYLES[item.status].color }}>{item.status}</span>
                    </td>
                    <td style={{ padding: "11px 11px", fontWeight: 600, color: "#0f2744", whiteSpace: "nowrap" }}>{item.name}</td>
                    <td style={{ padding: "11px 11px", textAlign: "right", color: item.taxAmount?"#0f2744":"#94a3b8" }}>{fmt(item.taxAmount)}</td>
                    <td style={{ padding: "11px 11px", textAlign: "right", fontWeight: 700, color: "#1e3a5f" }}>{fmt(item.noTaxAmount)}</td>
                    <td style={{ padding: "11px 11px", textAlign: "right" }}>
                      <span style={{ background: "#ede9fe", color: "#6d28d9", borderRadius: 6, padding: "2px 7px", fontWeight: 700, fontSize: 12 }}>{item.profitRate}%</span>
                    </td>
                    <td style={{ padding: "11px 11px", textAlign: "right", fontWeight: 700, color: s>0?"#059669":"#ef4444" }}>
                      {s!=null?fmt(Math.round(s)):"—"}
                    </td>
                    <td style={{ padding: "11px 11px", textAlign: "center", whiteSpace: "nowrap" }}>
                      <button onClick={() => openEdit(item)} style={{ ...ab, background:"#dbeafe", color:"#1d4ed8" }}>✏️</button>
                      <button onClick={() => setDeleteConfirm(item)} style={{ ...ab, background:"#fee2e2", color:"#dc2626", marginLeft:4 }}>🗑️</button>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: "#1e3a5f", color: "#fff", fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: "12px 11px" }}>合計</td>
                <td style={{ padding: "12px 11px", textAlign: "right" }}>{fmt(filtered.reduce((s,d)=>s+(d.taxAmount||0),0))}</td>
                <td style={{ padding: "12px 11px", textAlign: "right" }}>{fmt(filtered.reduce((s,d)=>s+d.noTaxAmount,0))}</td>
                <td />
                <td style={{ padding: "12px 11px", textAlign: "right", color: "#6ee7b7" }}>{fmt(Math.round(filtered.reduce((s,d)=>s+(surplus(d)||0),0)))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* CARD VIEW */}
      {viewMode === "card" && (
      <div style={{ padding: "0 20px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 }}>
          {filtered.map(item => {
            const s = surplus(item);
            const profitPct = Math.min(parseFloat(item.profitRate) || 0, 100);
            return (
              <div key={item.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", borderLeft: `4px solid ${item.type==="政收"?"#1d4ed8":"#059669"}`, position: "relative" }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0f2744", flex: 1, paddingRight: 8 }}>{item.name}</div>
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    <span style={{ ...tg, background: TAG_STYLES[item.type].bg, color: TAG_STYLES[item.type].color }}>{item.type}</span>
                    <span style={{ ...tg, background: STATUS_STYLES[item.status].bg, color: STATUS_STYLES[item.status].color }}>{item.status}</span>
                  </div>
                </div>
                {/* Amounts grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>含稅金額</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: item.taxAmount?"#1e3a5f":"#cbd5e1", marginTop: 1 }}>{item.taxAmount ? `${fmt(item.taxAmount)} 仟` : "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>未稅金額</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1e3a5f", marginTop: 1 }}>{fmt(item.noTaxAmount)} 仟</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>預估餘絀</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: s>0?"#059669":"#94a3b8", marginTop: 1 }}>{s!=null?`${fmt(Math.round(s))} 仟`:"—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>利潤率</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#6d28d9", marginTop: 1 }}>{item.profitRate}%</div>
                  </div>
                </div>
                {/* Profit rate bar */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>利潤率</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#6d28d9" }}>{item.profitRate}%</span>
                  </div>
                  <div style={{ background: "#f1f5f9", borderRadius: 6, height: 6, overflow: "hidden" }}>
                    <div style={{ width: `${profitPct}%`, background: "linear-gradient(90deg,#8b5cf6,#6d28d9)", height: "100%", borderRadius: 6, transition: "width 0.4s" }} />
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => openEdit(item)} style={{ ...ab, background:"#dbeafe", color:"#1d4ed8", padding:"5px 12px" }}>✏️ 編輯</button>
                  <button onClick={() => setDeleteConfirm(item)} style={{ ...ab, background:"#fee2e2", color:"#dc2626", padding:"5px 12px" }}>🗑️ 刪除</button>
                </div>
              </div>
            );
          })}
        </div>
        {/* Card summary */}
        <div style={{ marginTop: 14, background: "#1e3a5f", borderRadius: 12, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>合計 {filtered.length} 件</span>
          <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
            <span>未稅：<strong>{fmt(filtered.reduce((s,d)=>s+d.noTaxAmount,0))}</strong> 仟</span>
            <span style={{ color: "#6ee7b7" }}>餘絀：<strong>{fmt(Math.round(filtered.reduce((s,d)=>s+(surplus(d)||0),0)))}</strong> 仟</span>
          </div>
        </div>
      </div>
      )}

      {/* CHARTS */}
      <div style={{ padding: "0 20px 32px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1e3a5f", marginBottom: 14 }}>📊 數據分析</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 18 }}>

          {/* 分組進度 */}
          <div style={cd}>
            <div style={ct}>分組統計與佔比</div>
            {GROUP_KEYS.map((k,i) => {
              const [type, status] = k.split("-");
              const amt = data.filter(d=>d.type===type&&d.status===status).reduce((s,d)=>s+d.noTaxAmount,0);
              const cnt = data.filter(d=>d.type===type&&d.status===status).length;
              return (
                <div key={k} style={{ marginBottom:13 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:12, color:"#475569", display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ width:8, height:8, borderRadius:2, background:GROUP_COLORS[i], display:"inline-block" }} />
                      {k} <span style={{ color:"#94a3b8" }}>({cnt}件)</span>
                    </span>
                    <span style={{ fontSize:12, fontWeight:700, color:GROUP_COLORS[i] }}>{fmt(amt)} 仟</span>
                  </div>
                  <div style={{ background:"#f1f5f9", borderRadius:8, height:8, overflow:"hidden" }}>
                    <div style={{ width:`${totalNoTax?(amt/totalNoTax*100):0}%`, background:GROUP_COLORS[i], height:"100%", borderRadius:8, transition:"width 0.6s" }} />
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop:"1px solid #f1f5f9", paddingTop:12, marginTop:6, display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                { label:"政收合計", val:fmt(data.filter(d=>d.type==="政收").reduce((s,d)=>s+d.noTaxAmount,0)), color:"#3b82f6" },
                { label:"民收合計", val:fmt(data.filter(d=>d.type==="民收").reduce((s,d)=>s+d.noTaxAmount,0)), color:"#059669" },
              ].map((r,i)=>(
                <div key={i} style={{ background:"#f8fafc", borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ fontSize:10, color:"#64748b" }}>{r.label}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:r.color, marginTop:2 }}>{r.val} 仟</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop:12, background:"#faf5ff", borderRadius:8, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, color:"#6d28d9", fontWeight:600 }}>預估總餘絀</span>
              <span style={{ fontSize:18, fontWeight:700, color:"#8b5cf6" }}>{fmt(Math.round(totalSurplus))} 仟</span>
            </div>
          </div>

          {/* 1. 政收/民收 目標 vs 達成 群組柱狀圖 */}
          <div style={cd}>
            <div style={ct}>目標 vs 爭取金額（政收A / 民收B）</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={[
                { name:"政收 A", 目標金額: parseFloat(govTargetInput)||0, 爭取金額: data.filter(d=>d.type==="政收").reduce((s,d)=>s+d.noTaxAmount,0) },
                { name:"民收 B", 目標金額: parseFloat(civTargetInput)||0, 爭取金額: data.filter(d=>d.type==="民收").reduce((s,d)=>s+d.noTaxAmount,0) },
              ]} margin={{ top:16, right:10, left:-10, bottom:5 }} barCategoryGap="35%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
                <XAxis dataKey="name" tick={{ fontSize:12 }} />
                <YAxis tick={{ fontSize:10 }} />
                <Tooltip formatter={(v,n)=>[`${fmt(v)} 仟元`, n]} />
                <Legend wrapperStyle={{ fontSize:11 }} />
                <Bar dataKey="目標金額" fill="#cbd5e1" radius={[4,4,0,0]}>
                  <LabelList dataKey="目標金額" position="top" style={{ fontSize:10, fill:"#94a3b8" }} formatter={v=>v>0?fmt(v):""} />
                </Bar>
                <Bar dataKey="爭取金額" fill="#3b82f6" radius={[4,4,0,0]}>
                  <LabelList dataKey="爭取金額" position="top" style={{ fontSize:10, fill:"#475569" }} formatter={v=>fmt(v)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 2. 各案件餘絀排行 */}
          <div style={cd}>
            <div style={ct}>各案件餘絀排行（仟元）</div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart layout="vertical"
                data={[...dataWithCodes].map(d=>({ name:d.name, 餘絀:Math.round(surplus(d)||0), type:d.type })).sort((a,b)=>b.餘絀-a.餘絀)}
                margin={{ top:4, right:55, left:10, bottom:4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" horizontal={false} />
                <XAxis type="number" tick={{ fontSize:10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:10 }} width={95} />
                <Tooltip formatter={v=>[`${fmt(v)} 仟元`,"餘絀"]} />
                <Bar dataKey="餘絀" radius={[0,4,4,0]}>
                  {[...dataWithCodes].map(d=>({ name:d.name, 餘絀:Math.round(surplus(d)||0), type:d.type })).sort((a,b)=>b.餘絀-a.餘絀).map((d,i)=>(
                    <Cell key={i} fill={d.type==="政收"?"#3b82f6":"#10b981"} />
                  ))}
                  <LabelList dataKey="餘絀" position="right" style={{ fontSize:10, fill:"#475569" }} formatter={v=>fmt(v)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display:"flex", gap:12, marginTop:6, fontSize:11 }}>
              <span><span style={{ display:"inline-block", width:8, height:8, background:"#3b82f6", borderRadius:2, marginRight:4 }} />政收</span>
              <span><span style={{ display:"inline-block", width:8, height:8, background:"#10b981", borderRadius:2, marginRight:4 }} />民收</span>
            </div>
          </div>

          {/* 3. 利潤率分布 */}
          <div style={cd}>
            <div style={ct}>各案件利潤率排序（%）</div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart layout="vertical"
                data={[...dataWithCodes].map(d=>({ name:d.name, 利潤率:parseFloat(d.profitRate)||0, type:d.type })).sort((a,b)=>b.利潤率-a.利潤率)}
                margin={{ top:4, right:55, left:10, bottom:4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" horizontal={false} />
                <XAxis type="number" tick={{ fontSize:10 }} unit="%" />
                <YAxis type="category" dataKey="name" tick={{ fontSize:10 }} width={95} />
                <Tooltip formatter={v=>[`${v}%`,"利潤率"]} />
                <Bar dataKey="利潤率" radius={[0,4,4,0]}>
                  {[...dataWithCodes].map(d=>({ name:d.name, 利潤率:parseFloat(d.profitRate)||0, type:d.type })).sort((a,b)=>b.利潤率-a.利潤率).map((d,i)=>(
                    <Cell key={i} fill={d.type==="政收"?"#6366f1":"#f59e0b"} />
                  ))}
                  <LabelList dataKey="利潤率" position="right" style={{ fontSize:10, fill:"#475569" }} formatter={v=>`${v}%`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display:"flex", gap:12, marginTop:6, fontSize:11 }}>
              <span><span style={{ display:"inline-block", width:8, height:8, background:"#6366f1", borderRadius:2, marginRight:4 }} />政收</span>
              <span><span style={{ display:"inline-block", width:8, height:8, background:"#f59e0b", borderRadius:2, marginRight:4 }} />民收</span>
            </div>
          </div>

          {/* 4. 案件進度追蹤 */}
          <div style={cd}>
            <div style={ct}>案件進度追蹤（已簽約 vs 爭取中）</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[
                { name:"政收", 已簽約:data.filter(d=>d.type==="政收"&&d.status==="已簽約").length, 爭取中:data.filter(d=>d.type==="政收"&&d.status==="爭取中").length },
                { name:"民收", 已簽約:data.filter(d=>d.type==="民收"&&d.status==="已簽約").length, 爭取中:data.filter(d=>d.type==="民收"&&d.status==="爭取中").length },
              ]} margin={{ top:16, right:10, left:-10, bottom:5 }} barCategoryGap="40%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
                <XAxis dataKey="name" tick={{ fontSize:12 }} />
                <YAxis tick={{ fontSize:10 }} allowDecimals={false} />
                <Tooltip formatter={(v,n)=>[`${v} 件`, n]} />
                <Legend wrapperStyle={{ fontSize:11 }} />
                <Bar dataKey="已簽約" fill="#10b981" radius={[4,4,0,0]}>
                  <LabelList dataKey="已簽約" position="top" style={{ fontSize:11, fill:"#475569" }} formatter={v=>`${v}件`} />
                </Bar>
                <Bar dataKey="爭取中" fill="#f59e0b" radius={[4,4,0,0]}>
                  <LabelList dataKey="爭取中" position="top" style={{ fontSize:11, fill:"#475569" }} formatter={v=>`${v}件`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 5. 政收 vs 民收 圓餅圖 */}
          <div style={cd}>
            <div style={ct}>政收 vs 民收 金額佔比（已簽約）</div>
            {(() => {
              const govAmt = data.filter(d=>d.type==="政收"&&d.status==="已簽約").reduce((s,d)=>s+d.noTaxAmount,0);
              const civAmt = data.filter(d=>d.type==="民收"&&d.status==="已簽約").reduce((s,d)=>s+d.noTaxAmount,0);
              const total = govAmt + civAmt;
              if (total === 0) return (
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:190, color:"#94a3b8", fontSize:13 }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
                  <div>目前無已簽約案件</div>
                </div>
              );
              const pieData = [
                ...(govAmt > 0 ? [{ name:"政收", value:govAmt, color:"#1d4ed8" }] : []),
                ...(civAmt > 0 ? [{ name:"民收", value:civAmt, color:"#059669" }] : []),
              ];
              return (<>
                {(govAmt === 0 || civAmt === 0) && (
                  <div style={{ background:"#fef9c3", border:"1px solid #fde68a", borderRadius:8, padding:"6px 10px", fontSize:11, color:"#92400e", marginBottom:8 }}>
                    ⚠️ {govAmt === 0 ? "政收" : "民收"}目前無已簽約案件，圖表僅顯示單一類別
                  </div>
                )}
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={78} innerRadius={38}
                      label={({ name, percent })=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                      {pieData.map((d,i)=><Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={v=>[`${fmt(v)} 仟元`,"金額"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display:"flex", justifyContent:"center", gap:20, marginTop:6, fontSize:12 }}>
                  {pieData.map((d,i)=>(
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ width:10, height:10, background:d.color, borderRadius:2, display:"inline-block" }} />
                      <span style={{ color:"#64748b" }}>{d.name}</span>
                      <span style={{ fontWeight:700, color:d.color }}>{fmt(d.value)} 仟</span>
                    </div>
                  ))}
                </div>
              </>);
            })()}
          </div>

          {/* 6a. 風險集中度 - 政收 */}
          {(() => {
            const govTotal = data.filter(d=>d.type==="政收").reduce((s,d)=>s+d.noTaxAmount,0);
            const govItems = [...dataWithCodes].filter(d=>d.type==="政收").map(d=>({ name:d.name, 佔比:govTotal>0?parseFloat((d.noTaxAmount/govTotal*100).toFixed(1)):0, 金額:d.noTaxAmount })).sort((a,b)=>b.佔比-a.佔比);
            return (
              <div style={cd}>
                <div style={ct}>政收各案件金額佔比（風險集中度）</div>
                <ResponsiveContainer width="100%" height={govItems.length*38+40}>
                  <BarChart layout="vertical" data={govItems} margin={{ top:4, right:55, left:10, bottom:4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize:10 }} unit="%" domain={[0,100]} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize:10 }} width={95} />
                    <Tooltip formatter={(v,n,p)=>[`${v}%（${fmt(p.payload.金額)} 仟元）`,"佔比"]} />
                    <Bar dataKey="佔比" fill="#3b82f6" radius={[0,4,4,0]}>
                      {govItems.map((_,i)=><Cell key={i} fill={`hsl(${220-i*12},80%,${55+i*3}%)`} />)}
                      <LabelList dataKey="佔比" position="right" style={{ fontSize:10, fill:"#475569" }} formatter={v=>`${v}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* 6b. 風險集中度 - 民收 */}
          {(() => {
            const civTotal = data.filter(d=>d.type==="民收").reduce((s,d)=>s+d.noTaxAmount,0);
            const civItems = [...dataWithCodes].filter(d=>d.type==="民收").map(d=>({ name:d.name, 佔比:civTotal>0?parseFloat((d.noTaxAmount/civTotal*100).toFixed(1)):0, 金額:d.noTaxAmount })).sort((a,b)=>b.佔比-a.佔比);
            return (
              <div style={cd}>
                <div style={ct}>民收各案件金額佔比（風險集中度）</div>
                <ResponsiveContainer width="100%" height={civItems.length*38+40}>
                  <BarChart layout="vertical" data={civItems} margin={{ top:4, right:55, left:10, bottom:4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize:10 }} unit="%" domain={[0,100]} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize:10 }} width={95} />
                    <Tooltip formatter={(v,n,p)=>[`${v}%（${fmt(p.payload.金額)} 仟元）`,"佔比"]} />
                    <Bar dataKey="佔比" fill="#10b981" radius={[0,4,4,0]}>
                      {civItems.map((_,i)=><Cell key={i} fill={`hsl(${155-i*10},65%,${45+i*3}%)`} />)}
                      <LabelList dataKey="佔比" position="right" style={{ fontSize:10, fill:"#475569" }} formatter={v=>`${v}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

        </div>
      </div>

      {/* ADD/EDIT MODAL */}
      {showModal && (
        <div style={ov}>
          <div style={mo}>
            <div style={{ fontSize:16, fontWeight:700, color:"#1e3a5f", marginBottom:18 }}>
              {editId!=null?"✏️ 編輯案件":"＋ 新增案件"}
            </div>
            <div style={fg}><label style={fl}>案名 *</label>
              <input style={fi} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div style={fg}><label style={fl}>類型</label>
                <select style={fi} value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value}))}>
                  <option>政收</option><option>民收</option>
                </select>
              </div>
              <div style={fg}><label style={fl}>狀態</label>
                <select style={fi} value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))}>
                  <option>已簽約</option><option>爭取中</option>
                </select>
              </div>
              <div style={fg}><label style={fl}>目標含稅金額 (仟元)</label>
                <input style={fi} type="number" value={form.taxAmount} onChange={e => {
                  const tax = e.target.value;
                  const noTax = tax !== "" ? Math.round(parseFloat(tax) / 1.05) : "";
                  setForm(p => ({ ...p, taxAmount: tax, noTaxAmount: noTax === "" ? p.noTaxAmount : noTax }));
                }} placeholder="選填 (全程金額)" />
              </div>
              <div style={fg}>
                <label style={fl}>未稅金額 (仟元) * <span style={{ color:"#94a3b8", fontWeight:400 }}>（含稅÷1.05自動計算）</span></label>
                <input style={{ ...fi, background: form.taxAmount ? "#f0f9ff" : "#fff" }} type="number" value={form.noTaxAmount} onChange={e=>setForm(p=>({...p,noTaxAmount:e.target.value}))} />
              </div>
              <div style={fg}><label style={fl}>利潤率 (%)</label>
                <input style={fi} type="number" value={form.profitRate} onChange={e=>setForm(p=>({...p,profitRate:e.target.value}))} />
              </div>
            </div>
            {form.profitRate&&form.noTaxAmount&&(
              <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:8, padding:"8px 12px", marginTop:4, fontSize:13, color:"#15803d" }}>
                預估餘絀：<strong>{fmt(Math.round(parseFloat(form.noTaxAmount)*parseFloat(form.profitRate)/100))} 仟元</strong>
              </div>
            )}
            <div style={{ display:"flex", gap:10, marginTop:18, justifyContent:"flex-end" }}>
              <button onClick={()=>setShowModal(false)} style={btn("#94a3b8")}>取消</button>
              <button onClick={handleSave} style={btn("#2563eb")}>儲存</button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE */}
      {deleteConfirm&&(
        <div style={ov}>
          <div style={{...mo,maxWidth:360}}>
            <div style={{ fontSize:22, textAlign:"center", marginBottom:8 }}>⚠️</div>
            <div style={{ fontSize:14, fontWeight:600, color:"#1e3a5f", textAlign:"center", marginBottom:6 }}>確認刪除</div>
            <div style={{ color:"#475569", textAlign:"center", fontSize:13, marginBottom:18 }}>確定要刪除「{deleteConfirm.name}」嗎？</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button onClick={()=>setDeleteConfirm(null)} style={btn("#94a3b8")}>取消</button>
              <button onClick={()=>handleDelete(deleteConfirm)} style={btn("#dc2626")}>確認刪除</button>
            </div>
          </div>
        </div>
      )}

      {/* LOG */}
      {showLog&&(
        <div style={ov}>
          <div style={{...mo,maxWidth:600,maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#1e3a5f" }}>📋 操作記錄</div>
              <button onClick={()=>setShowLog(false)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"#64748b" }}>✕</button>
            </div>
            <div style={{ overflowY:"auto", flex:1 }}>
              {logs.length===0&&<div style={{ color:"#94a3b8", textAlign:"center", padding:20 }}>尚無記錄</div>}
              {logs.map(log=>(
                <div key={log.id} style={{ padding:"9px 12px", borderRadius:8, marginBottom:7,
                  background:log.action==="刪除"?"#fef2f2":log.action==="新增"?"#f0fdf4":"#f0f9ff", fontSize:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                    <span style={{ fontWeight:700, color:log.action==="刪除"?"#dc2626":log.action==="新增"?"#059669":"#0284c7" }}>
                      {log.action==="新增"?"＋":log.action==="刪除"?"🗑":"✏️"} {log.action}：{log.name}
                    </span>
                    <span style={{ color:"#94a3b8" }}>{log.time}</span>
                  </div>
                  <div style={{ color:"#64748b" }}>{log.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btn = bg => ({ background:bg, color:"#fff", border:"none", borderRadius:8, padding:"8px 15px", cursor:"pointer", fontSize:13, fontWeight:600, whiteSpace:"nowrap" });
const fbtn = active => ({ border:`1.5px solid ${active?"#1e3a5f":"#cbd5e1"}`, borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:13, fontWeight:500, background:active?"#1e3a5f":"#fff", color:active?"#fff":"#475569", transition:"all 0.15s" });
const tg = { borderRadius:6, padding:"2px 7px", fontSize:11, fontWeight:700, whiteSpace:"nowrap" };
const ab = { border:"none", borderRadius:6, padding:"4px 9px", cursor:"pointer", fontSize:12, fontWeight:600 };
const ov = { position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:16 };
const mo = { background:"#fff", borderRadius:16, padding:"24px 22px", width:"100%", maxWidth:500, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" };
const cd = { background:"#fff", borderRadius:14, padding:"18px 18px 14px", boxShadow:"0 2px 10px rgba(0,0,0,0.07)" };
const ct = { fontWeight:600, color:"#334155", marginBottom:12, fontSize:13 };
const fg = { display:"flex", flexDirection:"column", marginBottom:11 };
const fl = { fontSize:11, color:"#64748b", marginBottom:3, fontWeight:600 };
const fi = { border:"1.5px solid #e2e8f0", borderRadius:8, padding:"8px 11px", fontSize:14, outline:"none", color:"#1e3a5f" };
