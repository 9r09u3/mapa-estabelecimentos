"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import TabBar from "../components/TabBar";
import AddEstablishmentModal from "../components/AddEstablishmentModal";
import ReviewPanel from "../components/ReviewPanel";
import RankingList from "../components/RankingList";

interface Position {
  lat: number;
  lng: number;
}

interface Establishment {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  has_water: boolean;
  has_bathroom: boolean;
  has_power: boolean;
  final_score: number | null;
  reviews_count: number;
  [key: string]: any;
}

interface Review {
  id: string;
  establishment_id: string;
  rating: number;
  service_rating: number;
  comment: string;
  has_water: boolean;
  has_bathroom: boolean;
  has_power: boolean;
  staff_count: number;
  wait_time: number;
  approved: boolean;
  [key: string]: any;
}

interface Filters {
  has_water: boolean;
  has_bathroom: boolean;
  has_power: boolean;
  show_evaluated: boolean;
  show_unevaluated: boolean;
}

interface ReviewFormData {
  service_rating: number;
  comment?: string;
  has_water: boolean;
  has_bathroom: boolean;
  has_power: boolean;
  staff_count: number;
  wait_time: number;
}

interface EstablishmentFlags {
  has_water: boolean;
  has_bathroom: boolean;
  has_power: boolean;
}

const LeafletMap = dynamic(() => import("../components/LeafletMap"), { 
  ssr: false,
  loading: () => <div style={{ height: "100vh", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>Carregando mapa...</div>
});

function computeFinalScoreFromReview(r: any): number {
  const service = Number(r.service_rating ?? r.rating ?? 0);
  const wait_time = Number(r.wait_time ?? 0);

  let wait_score = 1;
  if (wait_time <= 5) wait_score = 5;
  else if (wait_time <= 10) wait_score = 3;
  else wait_score = 1;

  const infraCount = [r.has_water, r.has_bathroom, r.has_power].filter(Boolean).length;
  let infra_score = 1;
  if (infraCount === 0) infra_score = 1;
  else if (infraCount === 1) infra_score = 2;
  else if (infraCount === 2) infra_score = 3;
  else infra_score = 5;

  const finalScore = service * 0.6 + wait_score * 0.3 + infra_score * 0.1;
  return Number.isFinite(finalScore) ? finalScore : 0;
}

export default function Page() {
  const [tab, setTab] = useState<"map" | "ranking">("map");
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<Position | null>(null);
  const [addMode, setAddMode] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Establishment[]>([]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const [filters, setFilters] = useState<Filters>({ 
    has_water: false, 
    has_bathroom: false, 
    has_power: false,
    show_evaluated: true,
    show_unevaluated: false
  });
  
  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [selectedEstablishment, setSelectedEstablishment] = useState<Establishment | null>(null);
  const [searchResultEstablishment, setSearchResultEstablishment] = useState<Establishment | null>(null);

  async function loadAll() {
    try {
      const [{ data: estData, error: estError }, { data: revData, error: revError }] = await Promise.all([
        supabase.from("establishments").select("*"),
        supabase.from("reviews").select("*").eq("approved", true)
      ]);

      if (estError) throw estError;
      if (revError) throw revError;

      const revs = revData || [];
      setReviews(revs);

      const byId: Record<string, number[]> = {};
      const byCount: Record<string, number> = {};

      for (const r of revs) {
        const s = computeFinalScoreFromReview(r);
        if (!byId[r.establishment_id]) byId[r.establishment_id] = [];
        byId[r.establishment_id].push(s);
        byCount[r.establishment_id] = (byCount[r.establishment_id] || 0) + 1;
      }

      const enriched = (estData || []).map((e: any) => {
        const arr = byId[e.id] || [];
        const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        return { ...e, final_score: avg, reviews_count: byCount[e.id] || 0 };
      });

      setEstablishments(enriched);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    }
  }

  useEffect(() => { 
    loadAll(); 
  }, []);

  useEffect(() => {
    const q = (searchQuery || "").trim().toLowerCase();
    if (!q) {
      setSuggestions([]);
      setSearchResultEstablishment(null);
      return;
    }

    const s = establishments.filter(e => e.name?.toLowerCase().includes(q));
    setSuggestions(s.slice(0, 8));
  }, [searchQuery, establishments]);

  const handleSuggestionClick = useCallback((establishment: Establishment) => {
    if (!establishment) return;
    
    setTab("map");
    setSearchQuery("");
    setSuggestions([]);
    setSearchExpanded(false);
    
    // Mostrar o estabelecimento encontrado mesmo se filtros não permitirem
    setSearchResultEstablishment(establishment);
    
    setTimeout(() => {
      setSelectedEstablishment(establishment);
    }, 100);
  }, []);

  useEffect(() => {
    if (selectedEstablishment) {
      const timer = setTimeout(() => {
        setSelectedEstablishment(null);
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [selectedEstablishment]);

  // Limpar estabelecimento da busca quando clicar em outro lugar
  const handleMapClick = useCallback((position: Position) => {
    setSelectedPoint(position);
    setSearchResultEstablishment(null); // Limpar resultado da busca
    // NÃO seta addMode como true aqui - só abre popup no mapa
  }, []);

  const handleOpenAddModal = () => {
    if (!selectedPoint) return;
    setAddMode(true);
  };

  const handleCloseAddModal = () => {
    setAddMode(false);
    setSelectedPoint(null);
  };

  const submitPendingEstablishmentAndOptionalReview = async (
    name: string, 
    address: string, 
    flags: EstablishmentFlags, 
    wantToReview: boolean, 
    reviewData?: ReviewFormData
  ): Promise<void> => {
    if (!selectedPoint) {
      alert("Marque a posição no mapa antes de enviar.");
      return;
    }

    if (!name || name.trim().length < 2 || name.trim().length > 100) {
      alert("Nome do estabelecimento deve ter entre 2 e 100 caracteres.");
      return;
    }

    try {
      console.log("Iniciando envio do estabelecimento...");
      
      const pendingData = {
        name: name.trim(),
        address: address ? address.trim().slice(0, 200) : "",
        lat: Number(selectedPoint.lat),
        lng: Number(selectedPoint.lng),
        has_water: Boolean(flags?.has_water),
        has_bathroom: Boolean(flags?.has_bathroom),
        has_power: Boolean(flags?.has_power),
        submitted_by: "public"
      };

      console.log("Dados do estabelecimento:", pendingData);

      const { data: establishmentData, error: establishmentError } = await supabase
        .from("pending_establishments")
        .insert([pendingData])
        .select()
        .single();

      if (establishmentError) {
        console.error("Erro ao inserir estabelecimento:", establishmentError);
        throw new Error(`Erro no estabelecimento: ${establishmentError.message}`);
      }

      console.log("Estabelecimento inserido com sucesso:", establishmentData);

      if (wantToReview && reviewData) {
        console.log("Preparando para enviar review...");
        
        if (!reviewData.service_rating || reviewData.service_rating === 0) {
          alert("Estabelecimento enviado, mas a avaliação precisa de uma classificação com estrelas.");
          setSelectedPoint(null);
          setAddMode(false);
          return;
        }

        const reviewPayload = {
          establishment_id: null,
          rating: Number(reviewData.service_rating),
          service_rating: Number(reviewData.service_rating),
          comment: String(reviewData.comment || "").slice(0, 500),
          has_water: Boolean(reviewData.has_water),
          has_bathroom: Boolean(reviewData.has_bathroom),
          has_power: Boolean(reviewData.has_power),
          staff_count: Math.max(0, Math.min(100, Number(reviewData.staff_count || 0))),
          wait_time: Math.max(0, Math.min(480, Number(reviewData.wait_time || 0))),
          approved: false,
          moderator_note: `pending_establishment_id:${establishmentData.id}`
        };

        console.log("Dados da review:", reviewPayload);

        const { error: reviewError } = await supabase
          .from("reviews")
          .insert([reviewPayload]);

        if (reviewError) {
          console.error("Erro ao inserir review:", reviewError);
          alert("Estabelecimento enviado para moderação, mas houve um erro ao enviar a avaliação.");
        } else {
          console.log("Review inserida com sucesso");
          alert("Obrigado! Estabelecimento e avaliação enviados para moderação.");
        }
      } else {
        alert("Obrigado! Estabelecimento enviado para moderação.");
      }

      setSelectedPoint(null);
      setAddMode(false);
      // Recarregar dados para atualizar lista
      loadAll();
      
    } catch (error: any) {
      console.error("Erro detalhado no processo:", error);
      alert(`Erro ao enviar: ${error.message || "Tente novamente."}`);
    }
  };

  const handleSubmitReviewForApproved = async (formData: ReviewFormData): Promise<void> => {
    if (!reviewTarget) {
      alert("Estabelecimento não selecionado.");
      return;
    }

    try {
      console.log("Iniciando envio da review...");
      console.log("Dados recebidos:", formData);
      
      if (!formData.service_rating || formData.service_rating === 0) {
        alert("Por favor, avalie o atendimento com as estrelas.");
        return;
      }

      const payload = {
        establishment_id: reviewTarget,
        rating: Number(formData.service_rating),
        service_rating: Number(formData.service_rating),
        wait_time: Math.max(0, Math.min(480, Number(formData.wait_time || 0))),
        staff_count: Math.max(0, Math.min(100, Number(formData.staff_count || 0))),
        comment: String(formData.comment || "").slice(0, 500),
        has_water: Boolean(formData.has_water),
        has_bathroom: Boolean(formData.has_bathroom),
        has_power: Boolean(formData.has_power),
        approved: false
      };

      console.log("Payload da review:", payload);

      const { error } = await supabase
        .from("reviews")
        .insert([payload]);

      if (error) {
        console.error("Erro do Supabase:", error);
        alert(`Erro ao enviar avaliação: ${error.message}`);
        return;
      }

      console.log("Review enviada com sucesso!");
      alert("Avaliação enviada para moderação!");
      setReviewTarget(null);
      // Recarregar dados para atualizar contagem de avaliações
      loadAll();
      
    } catch (error: any) {
      console.error("Erro inesperado:", error);
      alert(`Erro inesperado: ${error.message || "Tente novamente."}`);
    }
  };

  function getFilteredList(): Establishment[] {
    let list = establishments.slice();
    
    if (filters.show_evaluated && !filters.show_unevaluated) {
      list = list.filter(e => e.reviews_count > 0);
    } else if (!filters.show_evaluated && filters.show_unevaluated) {
      list = list.filter(e => e.reviews_count === 0);
    } else if (!filters.show_evaluated && !filters.show_unevaluated) {
      list = [];
    }
    
    if (filters.has_water) list = list.filter(e => e.has_water);
    if (filters.has_bathroom) list = list.filter(e => e.has_bathroom);
    if (filters.has_power) list = list.filter(e => e.has_power);

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(e => e.name?.toLowerCase().includes(q));
    }

    return list;
  }

  // Lista para o mapa: filtros normais + estabelecimento da busca (se existir)
  function getMapEstablishments(): Establishment[] {
    const filteredList = getFilteredList();
    
    // Se temos um resultado de busca específico, adiciona ele à lista mesmo se não passar nos filtros
    if (searchResultEstablishment && !filteredList.some(e => e.id === searchResultEstablishment.id)) {
      return [...filteredList, searchResultEstablishment];
    }
    
    return filteredList;
  }

  const rankingMapped = [...establishments]
    .map(e => ({ ...e, sortScore: e.final_score ?? 999 }))
    .sort((a, b) => a.sortScore - b.sortScore);

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {tab === "map" && (
        <>
          {/* Barra superior esquerda com ícones */}
          <div style={{ 
            position: "absolute", 
            top: 12, 
            left: 12, 
            zIndex: 1000, 
            display: "flex", 
            gap: 8,
            flexDirection: "column",
            alignItems: "flex-start"
          }}>
            {/* Botão de busca */}
            <div style={{ 
              background: "white", 
              borderRadius: 12, 
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              overflow: "hidden",
              width: searchExpanded ? 280 : 48,
              transition: "width 0.3s ease",
              display: "flex",
              alignItems: "center"
            }}>
              {searchExpanded && (
                <div style={{ flex: 1, padding: "0 12px" }}>
                  <input
                    style={{ 
                      width: "100%", 
                      padding: "10px 0", 
                      border: "none", 
                      fontSize: 14,
                      outline: "none",
                      background: "transparent"
                    }}
                    placeholder="Buscar estabelecimento..."
                    value={searchQuery}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>
              )}
              <button
                onClick={() => {
                  setSearchExpanded(!searchExpanded);
                  if (searchExpanded) {
                    setSearchQuery("");
                    setSuggestions([]);
                    setSearchResultEstablishment(null);
                  }
                }}
                style={{ 
                  padding: "12px", 
                  background: "transparent", 
                  border: "none", 
                  cursor: "pointer",
                  minWidth: 48,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                {searchExpanded ? "✕" : "🔍"}
              </button>
            </div>

            {/* Botão de filtros */}
            <button
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              style={{ 
                padding: "12px", 
                background: "white", 
                borderRadius: 12, 
                border: "none", 
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                cursor: "pointer",
                minWidth: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              ⚙️
            </button>
          </div>

          {/* Painel de filtros expansível */}
          {filtersExpanded && (
            <div style={{ 
              position: "absolute", 
              top: 12, 
              left: 12, 
              zIndex: 1001, // Z-index maior para ficar na frente
              background: "white", 
              borderRadius: 12, 
              padding: 16, 
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              width: 220,
              maxHeight: "calc(100vh - 100px)",
              overflow: "auto"
            }}>
              {/* Botão X para fechar */}
              <button
                onClick={() => setFiltersExpanded(false)}
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "transparent",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                  color: "#6b7280",
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  transition: "background-color 0.2s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f3f4f6"}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
              >
                ×
              </button>

              <h4 style={{ marginBottom: 12, fontSize: 16, fontWeight: "bold", paddingRight: 24 }}>Filtros</h4>
              
              {/* Filtros de avaliação */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "#374151" }}>Avaliação</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                    <input 
                      type="checkbox" 
                      checked={filters.show_evaluated}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilters(f => ({ ...f, show_evaluated: e.target.checked }))} 
                    /> 
                    📝 Com avaliações
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                    <input 
                      type="checkbox" 
                      checked={filters.show_unevaluated}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilters(f => ({ ...f, show_unevaluated: e.target.checked }))} 
                    /> 
                    🆕 Sem avaliações
                  </label>
                </div>
              </div>

              {/* Filtros de infraestrutura */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "#374151" }}>Infraestrutura</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                    <input 
                      type="checkbox" 
                      checked={filters.has_water}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilters(f => ({ ...f, has_water: e.target.checked }))} 
                    /> 
                    💧 Água
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                    <input 
                      type="checkbox" 
                      checked={filters.has_bathroom}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilters(f => ({ ...f, has_bathroom: e.target.checked }))} 
                    /> 
                    🚻 Banheiro
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                    <input 
                      type="checkbox" 
                      checked={filters.has_power}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilters(f => ({ ...f, has_power: e.target.checked }))} 
                    /> 
                    🔌 Tomada
                  </label>
                </div>
              </div>

              {/* Botão para limpar filtros */}
              <button
                onClick={() => setFilters({ 
                  has_water: false, 
                  has_bathroom: false, 
                  has_power: false,
                  show_evaluated: true,
                  show_unevaluated: false
                })}
                style={{
                  width: "100%",
                  padding: "8px",
                  marginTop: 16,
                  background: "#f3f4f6",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 14
                }}
              >
                Limpar filtros
              </button>
            </div>
          )}

          {/* Sugestões de busca */}
          {searchExpanded && suggestions.length > 0 && (
            <div style={{ 
              position: "absolute", 
              top: 70, 
              left: 12, 
              zIndex: 1000, 
              background: "white", 
              borderRadius: 12, 
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              width: 280,
              maxHeight: "300px",
              overflow: "auto"
            }}>
              {suggestions.map((s: Establishment) => (
                <div
                  key={s.id}
                  onClick={() => handleSuggestionClick(s)}
                  style={{ 
                    padding: "12px", 
                    cursor: "pointer", 
                    borderBottom: "1px solid #f3f4f6",
                    transition: "background-color 0.2s"
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                    e.currentTarget.style.backgroundColor = "#f9fafb";
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                    e.currentTarget.style.backgroundColor = "white";
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{s.address}</div>
                </div>
              ))}
            </div>
          )}

          {/* Mapa */}
          <LeafletMap
            establishments={getMapEstablishments()} // Usa a nova função
            selectedPoint={selectedPoint}
            onMapClick={handleMapClick}
            onRequestReview={(id: string) => setReviewTarget(id)}
            selectedEstablishment={selectedEstablishment}
            onEstablishmentOpened={() => setSelectedEstablishment(null)}
            showAddModal={addMode}
            onCloseAddModal={handleCloseAddModal}
            onSubmitAddModal={submitPendingEstablishmentAndOptionalReview}
          />
        </>
      )}

      {tab === "ranking" && <RankingList establishments={rankingMapped} reviews={reviews} />}

      <TabBar active={tab} onChange={(newTab: "map" | "ranking") => setTab(newTab)} />

      <ReviewPanel
        targetId={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onSubmit={handleSubmitReviewForApproved}
        reviews={reviews}
        establishments={establishments}
      />
    </div>
  );
}