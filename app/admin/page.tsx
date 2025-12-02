"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function AdminPage() {
  const [user, setUser] = useState<any>(null);
  const [pendingEsts, setPendingEsts] = useState<any[]>([]);
  const [pendingRvs, setPendingRvs] = useState<any[]>([]);
  const [tab, setTab] = useState<"establishments"|"reviews"|"search">("establishments");
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [editingEst, setEditingEst] = useState<any>(null);

  useEffect(()=>{
    checkAndSetUser();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_, session) => {
      await checkAndSetUser(session?.user);
    });
    return () => sub.subscription.unsubscribe();
  },[]);

  async function checkAndSetUser(sessionUser?: any) {
    const userToCheck = sessionUser || (await supabase.auth.getSession()).data.session?.user;
    
    if (!userToCheck) {
      setUser(null);
      return;
    }

    if (!userToCheck.email) {
      console.warn('Usuário sem email tentou acessar admin');
      await supabase.auth.signOut();
      setUser(null);
      return;
    }

    try {
      const response = await fetch('/api/admin/verify-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: userToCheck.email })
      });

      if (!response.ok) {
        throw new Error('Erro na verificação de admin');
      }

      const result = await response.json();
      
      if (result.isAdmin) {
        setUser(userToCheck);
      } else {
        console.warn(`🚨 Usuário não autorizado tentou acessar: ${userToCheck.email}`);
        await supabase.auth.signOut();
        setUser(null);
        
        if (typeof window !== 'undefined') {
          alert("Acesso não autorizado.");
        }
      }
    } catch (error) {
      console.error("Erro ao verificar admin:", error);
      await supabase.auth.signOut();
      setUser(null);
      
      if (typeof window !== 'undefined') {
        alert("Erro de verificação. Tente novamente.");
      }
    }
  }

  async function signIn() {
    const email = prompt("Email do admin:");
    if (!email) return;
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert("Por favor, insira um email válido.");
      return;
    }

    try {
      const response = await fetch('/api/admin/verify-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      });

      const result = await response.json();
      
      if (!result.isAdmin) {
        alert("Link de acesso enviado para seu email. Verifique sua caixa de entrada.");
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({ 
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/admin`
        }
      });
      
      if (error) {
        console.error("Erro de login:", error);
        alert("Erro ao enviar link de acesso. Tente novamente.");
        return;
      }
      
      alert("Link de acesso enviado para seu email. Verifique sua caixa de entrada.");
    } catch (error) {
      console.error("Erro no processo de login:", error);
      alert("Erro no processo de login. Tente novamente.");
    }
  }

  async function signOut() { 
    await supabase.auth.signOut(); 
    setUser(null); 
  }

  async function loadPending(){
    if (!user) return;
    
    setLoading(true);
    try {
      const [{ data: ests, error: e1 }, { data: rvs, error: e2 }] = await Promise.all([
        supabase.from("pending_establishments").select("*").order("created_at",{ascending:true}).limit(100),
        supabase.from("reviews").select("*, establishments(name)").eq("approved", false).order("created_at",{ascending:true}).limit(100)
      ]);
      
      if(e1) {
        console.error("Erro ao carregar estabelecimentos:", e1);
        alert("Erro ao carregar estabelecimentos pendentes.");
      }
      if(e2) {
        console.error("Erro ao carregar avaliações:", e2);
        alert("Erro ao carregar avaliações pendentes.");
      }
      
      setPendingEsts(ests || []);
      setPendingRvs(rvs || []);
    } catch (error) {
      console.error("Erro inesperado:", error);
      alert("Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=> { 
    if(user) loadPending(); 
    else { 
      setPendingEsts([]); 
      setPendingRvs([]); 
    } 
  }, [user]);

  // NOVA FUNÇÃO: Aprovar todos os estabelecimentos de uma vez
  async function approveAllEsts() {
    if (!pendingEsts.length) {
      alert("Não há estabelecimentos para aprovar.");
      return;
    }
    
    if(!confirm(`Deseja aprovar todos os ${pendingEsts.length} estabelecimentos pendentes?`)) return;
    
    setActionInProgress("approve-all-ests");
    
    try {
      const response = await fetch('/api/admin/approve-establishments-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.id}`
        },
        body: JSON.stringify({ 
          pendingIds: pendingEsts.map(p => p.id),
          userEmail: user.email 
        })
      });

      if (!response.ok) {
        throw new Error('Erro na requisição');
      }

      const result = await response.json();
      
      if (result.success) {
        setPendingEsts([]);
        alert(`✅ Aprovados ${result.approvedCount} estabelecimentos.${result.errorCount > 0 ? ` Falhas: ${result.errorCount}` : ''}`);
      } else {
        alert("Erro ao aprovar estabelecimentos: " + (result.error || "Erro desconhecido"));
      }
    } catch (error) {
      console.error("Erro ao aprovar todos os estabelecimentos:", error);
      alert("Erro ao aprovar estabelecimentos.");
    } finally {
      setActionInProgress(null);
    }
  }

  // NOVA FUNÇÃO: Aprovar todas as avaliações de uma vez
  async function approveAllReviews() {
    if (!pendingRvs.length) {
      alert("Não há avaliações para aprovar.");
      return;
    }
    
    if(!confirm(`Deseja aprovar todas as ${pendingRvs.length} avaliações pendentes?`)) return;
    
    setActionInProgress("approve-all-reviews");
    
    try {
      const moderator = user?.email ?? "admin";
      const { error } = await supabase
        .from("reviews")
        .update({ 
          approved: true, 
          moderated_by: moderator, 
          moderated_at: new Date().toISOString() 
        })
        .in("id", pendingRvs.map(r => r.id));

      if(error) throw error;

      setPendingRvs([]);
      alert(`✅ Aprovadas ${pendingRvs.length} avaliações.`);
    } catch (error) {
      console.error("Erro ao aprovar todas as avaliações:", error);
      alert("Erro ao aprovar avaliações.");
    } finally {
      setActionInProgress(null);
    }
  }

  async function approveEst(pendingId: string){
    if (actionInProgress) return;
    setActionInProgress(`approve-est-${pendingId}`);

    try {
      const response = await fetch('/api/admin/approve-establishment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.id}`
        },
        body: JSON.stringify({ 
          pendingId,
          userEmail: user.email 
        })
      });

      if (!response.ok) {
        throw new Error('Erro de autorização');
      }

      const result = await response.json();
      
      if (result.success) {
        setPendingEsts(prev => prev.filter(p => p.id !== pendingId));
      } else {
        alert("Erro ao aprovar estabelecimento: " + (result.error || "Erro desconhecido"));
      }
    } catch (error) {
      console.error("Erro ao aprovar estabelecimento:", error);
      alert("Erro ao aprovar estabelecimento. Tente novamente.");
    } finally {
      setActionInProgress(null);
    }
  }

  async function rejectEst(pendingId: string){
    if (actionInProgress) return;
    setActionInProgress(`reject-est-${pendingId}`);
    
    if(!confirm("Deseja realmente rejeitar este estabelecimento?")) {
      setActionInProgress(null);
      return;
    }

    try {
      const { error } = await supabase
        .from("pending_establishments")
        .delete()
        .eq("id", pendingId);

      if(error) throw error;

      setPendingEsts(prev => prev.filter(p => p.id !== pendingId));
    } catch (error) {
      console.error("Erro ao rejeitar estabelecimento:", error);
      alert("Erro ao rejeitar estabelecimento. Tente novamente.");
    } finally {
      setActionInProgress(null);
    }
  }

  async function approveReview(reviewId: string){
    if (actionInProgress) return;
    setActionInProgress(`approve-review-${reviewId}`);

    try {
      const moderator = user?.email ?? "admin";
      const { error } = await supabase
        .from("reviews")
        .update({ 
          approved: true, 
          moderated_by: moderator, 
          moderated_at: new Date().toISOString() 
        })
        .eq("id", reviewId);

      if(error) throw error;

      setPendingRvs(prev => prev.filter(r => r.id !== reviewId));
    } catch (error) {
      console.error("Erro ao aprovar avaliação:", error);
      alert("Erro ao aprovar avaliação. Tente novamente.");
    } finally {
      setActionInProgress(null);
    }
  }

  async function rejectReview(reviewId: string){
    if (actionInProgress) return;
    setActionInProgress(`reject-review-${reviewId}`);
    
    if(!confirm("Deseja realmente rejeitar esta avaliação?")) {
      setActionInProgress(null);
      return;
    }

    try {
      const moderator = user?.email ?? "admin";
      const { error } = await supabase
        .from("reviews")
        .update({ 
          approved: false, 
          moderated_by: moderator, 
          moderated_at: new Date().toISOString(), 
          moderator_note: "Rejeitado pelo admin" 
        })
        .eq("id", reviewId);

      if(error) throw error;

      setPendingRvs(prev => prev.filter(r => r.id !== reviewId));
    } catch (error) {
      console.error("Erro ao rejeitar avaliação:", error);
      alert("Erro ao rejeitar avaliação. Tente novamente.");
    } finally {
      setActionInProgress(null);
    }
  }

  // FUNÇÃO: Buscar estabelecimentos
  async function searchEstablishments() {
    if (!searchTerm.trim()) {
      alert("Digite um termo para buscar");
      return;
    }

    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from("establishments")
        .select("*")
        .or(`name.ilike.%${searchTerm}%,address.ilike.%${searchTerm}%`)
        .limit(20);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error("Erro na busca:", error);
      alert("Erro ao buscar estabelecimentos.");
    } finally {
      setSearchLoading(false);
    }
  }

  // FUNÇÃO: Atualizar estabelecimento
  async function updateEstablishment() {
    if (!editingEst) return;

    try {
      const { error } = await supabase
        .from("establishments")
        .update({
          name: editingEst.name,
          address: editingEst.address,
          has_water: editingEst.has_water,
          has_bathroom: editingEst.has_bathroom,
          has_power: editingEst.has_power,
          lat: editingEst.lat,
          lng: editingEst.lng
        })
        .eq("id", editingEst.id);

      if (error) throw error;

      alert("Estabelecimento atualizado com sucesso!");
      setEditingEst(null);
      await searchEstablishments(); // Atualiza os resultados da busca
    } catch (error) {
      console.error("Erro ao atualizar:", error);
      alert("Erro ao atualizar estabelecimento.");
    }
  }

  // NOVA FUNÇÃO: Deletar estabelecimento
  async function deleteEstablishment(establishmentId: string) {
    if (!establishmentId) return;
    
    if (!confirm("ATENÇÃO: Tem certeza que deseja deletar este estabelecimento?\n\nEsta ação é irreversível e também deletará todas as avaliações relacionadas a ele.")) {
      return;
    }

    setActionInProgress(`delete-est-${establishmentId}`);
    
    try {
      // Primeiro deleta as avaliações relacionadas
      const { error: reviewsError } = await supabase
        .from("reviews")
        .delete()
        .eq("establishment_id", establishmentId);

      if (reviewsError) {
        console.error("Erro ao deletar avaliações:", reviewsError);
        // Continua mesmo com erro nas avaliações, tenta deletar o estabelecimento
      }

      // Depois deleta o estabelecimento
      const { error } = await supabase
        .from("establishments")
        .delete()
        .eq("id", establishmentId);

      if (error) throw error;

      alert("✅ Estabelecimento deletado com sucesso!");
      
      // Remove da lista de resultados
      setSearchResults(prev => prev.filter(est => est.id !== establishmentId));
      setEditingEst(null);
      
    } catch (error) {
      console.error("Erro ao deletar estabelecimento:", error);
      alert("Erro ao deletar estabelecimento.");
    } finally {
      setActionInProgress(null);
    }
  }

  if(!user){
    return (
      <div style={{ padding:20, maxWidth: 600, margin: '0 auto' }}>
        <h2>Painel Administrativo</h2>
        <p style={{ marginBottom: 16 }}>Acesso restrito a administradores autorizados.</p>
        <button 
          onClick={signIn}
          style={{
            padding: '12px 24px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Entrar com Email
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding:16, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap: 'wrap', gap: 12 }}>
        <h2>Painel Administrativo</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, color: '#666' }}>Conectado: {user.email}</span>
          <button 
            onClick={signOut}
            style={{
              padding: '8px 16px',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            Sair
          </button>
        </div>
      </div>

      <div style={{ marginTop:20, display:"flex", gap:8, flexWrap: 'wrap' }}>
        <button 
          onClick={()=>setTab("establishments")} 
          style={{ 
            padding: '12px 20px', 
            background: tab==="establishments" ? "#10b981" : "#6b7280", 
            color:"#fff", 
            border:"none", 
            borderRadius:8,
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Estabelecimentos Pendentes ({pendingEsts.length})
        </button>
        <button 
          onClick={()=>setTab("reviews")} 
          style={{ 
            padding: '12px 20px', 
            background: tab==="reviews" ? "#10b981" : "#6b7280", 
            color:"#fff", 
            border:"none", 
            borderRadius:8,
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Avaliações Pendentes ({pendingRvs.length})
        </button>
        <button 
          onClick={()=>setTab("search")} 
          style={{ 
            padding: '12px 20px', 
            background: tab==="search" ? "#10b981" : "#6b7280", 
            color:"#fff", 
            border:"none", 
            borderRadius:8,
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Buscar/Editar Estabelecimentos
        </button>
        
        {/* Botões de aprovação em massa - aparecem apenas quando há itens */}
        {tab === "establishments" && pendingEsts.length > 0 && (
          <button 
            onClick={approveAllEsts} 
            disabled={actionInProgress === "approve-all-ests"}
            style={{ 
              marginLeft: 'auto',
              padding: '12px 20px',
              background: actionInProgress === "approve-all-ests" ? "#9ca3af" : "#10b981", 
              color:"#fff", 
              border:"none", 
              borderRadius:8,
              cursor: actionInProgress === "approve-all-ests" ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {actionInProgress === "approve-all-ests" ? "Aprovando..." : `Aprovar Todos (${pendingEsts.length})`}
          </button>
        )}
        
        {tab === "reviews" && pendingRvs.length > 0 && (
          <button 
            onClick={approveAllReviews} 
            disabled={actionInProgress === "approve-all-reviews"}
            style={{ 
              marginLeft: 'auto',
              padding: '12px 20px',
              background: actionInProgress === "approve-all-reviews" ? "#9ca3af" : "#10b981", 
              color:"#fff", 
              border:"none", 
              borderRadius:8,
              cursor: actionInProgress === "approve-all-reviews" ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {actionInProgress === "approve-all-reviews" ? "Aprovando..." : `Aprovar Todas (${pendingRvs.length})`}
          </button>
        )}
      </div>

      <div style={{ marginTop:24 }}>
        {tab==="establishments" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Estabelecimentos Pendentes de Aprovação</h3>
            {pendingEsts.length===0 && (
              <div style={{ 
                padding: 40, 
                textAlign: 'center', 
                color: '#6b7280',
                background: '#f9fafb',
                borderRadius: 8
              }}>
                Nenhum estabelecimento pendente.
              </div>
            )}
            {pendingEsts.map(p=>(
              <div key={p.id} style={{ 
                background: 'white', 
                padding: 16, 
                borderRadius: 8, 
                marginBottom: 12,
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>{p.name}</strong>
                    <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>{p.address || 'Sem endereço'}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>
                      Posição: {p.lat?.toFixed(6)}, {p.lng?.toFixed(6)} • 
                      Enviado em: {new Date(p.created_at).toLocaleString('pt-BR')}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                      {p.has_water && '💧 '}
                      {p.has_bathroom && '🚻 '}
                      {p.has_power && '🔌 '}
                    </div>
                  </div>
                  <div style={{ minWidth: 200 }}>
                    <div style={{ marginBottom: 12, textAlign: 'right' }}>
                      <button 
                        onClick={()=>approveEst(p.id)} 
                        disabled={actionInProgress === `approve-est-${p.id}`}
                        style={{ 
                          marginRight:8, 
                          padding:"10px 16px", 
                          background: actionInProgress === `approve-est-${p.id}` ? "#9ca3af" : "#10b981", 
                          color:"#fff", 
                          border:"none", 
                          borderRadius:6,
                          cursor: actionInProgress === `approve-est-${p.id}` ? 'not-allowed' : 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        {actionInProgress === `approve-est-${p.id}` ? 'Aprovando...' : 'Aprovar'}
                      </button>
                      <button 
                        onClick={()=>rejectEst(p.id)} 
                        disabled={actionInProgress === `reject-est-${p.id}`}
                        style={{ 
                          padding:"10px 16px", 
                          background: actionInProgress === `reject-est-${p.id}` ? "#9ca3af" : "#ef4444", 
                          color:"#fff", 
                          border:"none", 
                          borderRadius:6,
                          cursor: actionInProgress === `reject-est-${p.id}` ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {actionInProgress === `reject-est-${p.id}` ? 'Rejeitando...' : 'Rejeitar'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab==="reviews" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Avaliações Pendentes de Moderação</h3>
            {pendingRvs.length===0 && (
              <div style={{ 
                padding: 40, 
                textAlign: 'center', 
                color: '#6b7280',
                background: '#f9fafb',
                borderRadius: 8
              }}>
                Nenhuma avaliação pendente.
              </div>
            )}
            {pendingRvs.map(r=>(
              <div key={r.id} style={{ 
                background: 'white', 
                padding: 16, 
                borderRadius: 8, 
                marginBottom: 12,
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
                      Estabelecimento: {r.establishments?.name || `ID: ${r.establishment_id || "Pendente"}`}
                    </strong>
                    <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>
                      {r.comment || 'Sem comentário'}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>
                      ⭐ {r.service_rating ?? r.rating} • ⏱️ {r.wait_time} min • 👥 {r.staff_count} func.
                      {r.has_water && ' • 💧'}
                      {r.has_bathroom && ' • 🚻'}
                      {r.has_power && ' • 🔌'}
                    </div>
                    {r.moderator_note && (
                      <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                        Observação: {r.moderator_note}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
                      Enviado em: {new Date(r.created_at).toLocaleString('pt-BR')}
                    </div>
                  </div>
                  <div style={{ minWidth: 200 }}>
                    <div style={{ marginBottom: 12, textAlign: 'right' }}>
                      <button 
                        onClick={()=>approveReview(r.id)} 
                        disabled={actionInProgress === `approve-review-${r.id}`}
                        style={{ 
                          marginRight:8, 
                          padding:"10px 16px", 
                          background: actionInProgress === `approve-review-${r.id}` ? "#9ca3af" : "#10b981", 
                          color:"#fff", 
                          border:"none", 
                          borderRadius:6,
                          cursor: actionInProgress === `approve-review-${r.id}` ? 'not-allowed' : 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        {actionInProgress === `approve-review-${r.id}` ? 'Aprovando...' : 'Aprovar'}
                      </button>
                      <button 
                        onClick={()=>rejectReview(r.id)} 
                        disabled={actionInProgress === `reject-review-${r.id}`}
                        style={{ 
                          padding:"10px 16px", 
                          background: actionInProgress === `reject-review-${r.id}` ? "#9ca3af" : "#ef4444", 
                          color:"#fff", 
                          border:"none", 
                          borderRadius:6,
                          cursor: actionInProgress === `reject-review-${r.id}` ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {actionInProgress === `reject-review-${r.id}` ? 'Rejeitando...' : 'Rejeitar'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "search" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Buscar e Editar Estabelecimentos</h3>
            
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <input
                type="text"
                placeholder="Buscar por nome ou endereço..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ 
                  flex: 1, 
                  padding: '10px 12px', 
                  border: '1px solid #d1d5db', 
                  borderRadius: 6 
                }}
                onKeyPress={(e) => e.key === 'Enter' && searchEstablishments()}
              />
              <button 
                onClick={searchEstablishments} 
                disabled={searchLoading}
                style={{ 
                  padding: '10px 20px', 
                  background: searchLoading ? '#9ca3af' : '#3b82f6', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: 6,
                  cursor: searchLoading ? 'not-allowed' : 'pointer'
                }}
              >
                {searchLoading ? 'Buscando...' : 'Buscar'}
              </button>
            </div>

            {searchResults.length > 0 ? (
              <div>
                <h4>Resultados da Busca ({searchResults.length})</h4>
                {searchResults.map(est => (
                  <div key={est.id} style={{ 
                    background: 'white', 
                    padding: 16, 
                    borderRadius: 8, 
                    marginBottom: 12,
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                  }}>
                    {editingEst?.id === est.id ? (
                      <div>
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ display: 'block', marginBottom: 4 }}>Nome</label>
                          <input
                            type="text"
                            value={editingEst.name}
                            onChange={(e) => setEditingEst({...editingEst, name: e.target.value})}
                            style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: 4 }}
                          />
                        </div>
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ display: 'block', marginBottom: 4 }}>Endereço</label>
                          <input
                            type="text"
                            value={editingEst.address}
                            onChange={(e) => setEditingEst({...editingEst, address: e.target.value})}
                            style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: 4 }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="checkbox"
                              checked={editingEst.has_water}
                              onChange={(e) => setEditingEst({...editingEst, has_water: e.target.checked})}
                            />
                            💧 Água
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="checkbox"
                              checked={editingEst.has_bathroom}
                              onChange={(e) => setEditingEst({...editingEst, has_bathroom: e.target.checked})}
                            />
                            🚻 Banheiro
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="checkbox"
                              checked={editingEst.has_power}
                              onChange={(e) => setEditingEst({...editingEst, has_power: e.target.checked})}
                            />
                            🔌 Energia
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                          <button 
                            onClick={() => deleteEstablishment(editingEst.id)}
                            disabled={actionInProgress === `delete-est-${editingEst.id}`}
                            style={{ 
                              padding: '8px 16px', 
                              background: actionInProgress === `delete-est-${editingEst.id}` ? '#9ca3af' : '#ef4444', 
                              color: 'white', 
                              border: 'none', 
                              borderRadius: 6,
                              cursor: actionInProgress === `delete-est-${editingEst.id}` ? 'not-allowed' : 'pointer'
                            }}
                          >
                            {actionInProgress === `delete-est-${editingEst.id}` ? 'Deletando...' : '🗑️ Deletar'}
                          </button>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button 
                              onClick={() => setEditingEst(null)}
                              style={{ 
                                padding: '8px 16px', 
                                background: '#6b7280', 
                                color: 'white', 
                                border: 'none', 
                                borderRadius: 6,
                                cursor: 'pointer'
                              }}
                            >
                              Cancelar
                            </button>
                            <button 
                              onClick={updateEstablishment}
                              style={{ 
                                padding: '8px 16px', 
                                background: '#10b981', 
                                color: 'white', 
                                border: 'none', 
                                borderRadius: 6,
                                cursor: 'pointer'
                              }}
                            >
                              Salvar
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>{est.name}</strong>
                          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>{est.address}</div>
                          <div style={{ fontSize: 12, color: '#9ca3af' }}>
                            Posição: {est.lat?.toFixed(6)}, {est.lng?.toFixed(6)} • 
                            Criado em: {new Date(est.created_at).toLocaleString('pt-BR')}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                            {est.has_water && '💧 '}
                            {est.has_bathroom && '🚻 '}
                            {est.has_power && '🔌 '}
                          </div>
                        </div>
                        <button 
                          onClick={() => setEditingEst(est)}
                          style={{ 
                            padding: '8px 16px', 
                            background: '#3b82f6', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: 6,
                            cursor: 'pointer'
                          }}
                        >
                          Editar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : searchTerm && (
              <div style={{ 
                padding: 40, 
                textAlign: 'center', 
                color: '#6b7280',
                background: '#f9fafb',
                borderRadius: 8
              }}>
                Nenhum estabelecimento encontrado para "{searchTerm}"
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}