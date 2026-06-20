import { useEffect, useState } from "react";
import { HistoryItem, api } from "../api";

export default function History() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  useEffect(() => { api.history().then(setItems).catch(() => {}); }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Query History</h1>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex justify-between text-xs text-slate-400">
              <span className="uppercase">{it.scope}</span>
              <span>{new Date(it.created_at).toLocaleString()}</span>
            </div>
            <div className="font-medium mt-1">{it.question}</div>
            {it.answer && <p className="text-sm text-slate-600 mt-1 line-clamp-3">{it.answer}</p>}
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-slate-400">No queries yet.</li>}
      </ul>
    </div>
  );
}
