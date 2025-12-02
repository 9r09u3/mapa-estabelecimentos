"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function RankingPage() {
  const [establishments, setEstablishments] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data: estData } = await supabase.from("establishments").select("*");
      setEstablishments(estData || []);
    }
    load();
  }, []);

  const sorted = [...establishments].sort((a,b) => (a.final_score ?? 9999) - (b.final_score ?? 9999));

  return (
    <div style={{ padding: 16, paddingBottom: 120 }}>
      <h2 style={{ marginTop: 0 }}>Ranking — Piores para melhores</h2>
      {sorted.map(e => (
        <div key={e.id} style={{ padding: 12, borderRadius: 10, background: "#fff", marginTop: 8, boxShadow: "0 6px 18px rgba(2,6,23,0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div><strong>{e.name}</strong><div style={{ fontSize: 13, color: "#6b7280" }}>{e.address}</div></div>
            <div style={{ textAlign: "right" }}><div style={{ fontWeight: 700 }}>{(e.final_score ?? "—")}</div><div className="small">{e.reviews_count || 0} avaliações</div></div>
          </div>
        </div>
      ))}
    </div>
  );
}
