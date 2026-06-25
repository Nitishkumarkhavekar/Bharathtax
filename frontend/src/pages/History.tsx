import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { HistoryItem, api } from "../api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function History() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  useEffect(() => { api.history().then(setItems).catch(() => {}); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Clock className="size-5 text-primary" /> Query History</h2>
        <p className="text-sm text-muted-foreground">Your past research and document questions.</p>
      </div>
      <div className="space-y-3">
        {items.map((it) => (
          <Card key={it.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-1">
                <Badge variant={it.scope === "document" ? "secondary" : "default"}>{it.scope}</Badge>
                <span className="text-xs text-muted-foreground">{new Date(it.created_at).toLocaleString()}</span>
              </div>
              <div className="font-medium">{it.question}</div>
              {it.answer && <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{it.answer}</p>}
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No queries yet.</p>}
      </div>
    </div>
  );
}
