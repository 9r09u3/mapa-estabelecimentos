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
  created_at?: string;
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
  const [userLocation, setUserLocation] = useState<Position | null>(null);
  const [reviewViewMode, setReviewViewMode] = useState<'form' | 'reviews'>('form');

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Establishment[]>([]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

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
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  useEffect(() => {
    if (tab === "map" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.warn("Erro ao obter localização:", error.message);
          setUserLocation({
            lat: -16.6869,
            lng: -49.2648
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        }
      );
    }
  }, [tab]);

  async function loadAll() {
    try {
      // Buscar estabelecimentos com paginação
      let allEstData: any[] = [];
      let page = 0;
      const pageSize = 1000; // Tamanho da página
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("establishments")
          .select("*")
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allEstData = [...allEstData, ...data];
          page++;
          
          // Se retornou menos que pageSize, é a última página
          if (data.length < pageSize) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      console.log(`📊 Total estabelecimentos carregados: ${allEstData.length}`);

      // Resto do código permanece igual, usando allEstData em vez de estData
      const { data: revData, error: revError } = await supabase
        .from("reviews")
        .select("*")
        .eq("approved", true);

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

      const enriched = allEstData.map((e: any) => {
        const arr = byId[e.id] || [];
        const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        return { ...e, final_score: avg, reviews_count: byCount[e.id] || 0 };
      });

      setEstablishments(enriched);
      setLastUpdate(Date.now());
      
      // Log para verificar novos estabelecimentos
      const newEstablishments = enriched.filter(e => {
        const createdAt = new Date(e.created_at);
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return createdAt > oneWeekAgo;
      });
      console.log(`🆕 Estabelecimentos dos últimos 7 dias: ${newEstablishments.length}`);
      
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
    }
  }

  useEffect(() => { 
    loadAll();
    
    const establishmentChannel = supabase
      .channel('establishments-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'establishments'
        },
        () => {
          loadAll();
        }
      )
      .subscribe();
    
    const pendingChannel = supabase
      .channel('pending-changes')
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'pending_establishments'
        },
        () => {
          loadAll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(establishmentChannel);
      supabase.removeChannel(pendingChannel);
    };
  }, []);

  useEffect(() => {
    if (tab === "map") {
      loadAll();
    }
  }, [tab]);

  useEffect(() => {
    const q = (searchQuery || "").trim().toLowerCase();
    if (!q) {
      setSuggestions([]);
      setSearchResultEstablishment(null);
      return;
    }

    if (searchTimeout) clearTimeout(searchTimeout);

    const localResults = establishments.filter(e => 
      e.name?.toLowerCase().includes(q)
    ).slice(0, 8);

    setSuggestions(localResults);

    if (localResults.length > 0) {
      setSearchResultEstablishment(localResults[0]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("establishments")
          .select("*")
          .ilike("name", `%${q}%`)
          .limit(5);

        if (!error && data && data.length > 0) {
          setSuggestions(data);
          setSearchResultEstablishment(data[0]);
        }
      } catch (error) {
        console.error("Erro na busca:", error);
      }
    }, 600);

    setSearchTimeout(timeout);

    return () => {
      if (searchTimeout) clearTimeout(searchTimeout);
    };
  }, [searchQuery, establishments]);

  const handleSuggestionClick = useCallback((establishment: Establishment) => {
    if (!establishment) return;
    
    setTab("map");
    setSearchQuery("");
    setSuggestions([]);
    setSearchExpanded(false);
    
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

  const handleMapClick = useCallback((position: Position) => {
    setSelectedPoint(position);
    setSearchResultEstablishment(null); 
  }, []);

  const handleOpenAddModal = () => {
    if (!selectedPoint) return;
    setAddMode(true);
  };

  const handleCloseAddModal = () => {
    setAddMode(false);
    setSelectedPoint(null);
  };

  const handleViewReviews = useCallback((establishmentId: string) => {
    setReviewTarget(establishmentId);
    setReviewViewMode('reviews');
  }, []);

  const handleRequestReview = useCallback((establishmentId: string) => {
    setReviewTarget(establishmentId);
    setReviewViewMode('form');
  }, []);

  const handleCloseReviewPanel = useCallback(() => {
    setReviewTarget(null);
    setReviewViewMode('form');
  }, []);

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

      const { data: establishmentData, error: establishmentError } = await supabase
        .from("pending_establishments")
        .insert([pendingData])
        .select()
        .single();

      if (establishmentError) {
        throw new Error(`Erro no estabelecimento: ${establishmentError.message}`);
      }

      if (wantToReview && reviewData) {
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

        const { error: reviewError } = await supabase
          .from("reviews")
          .insert([reviewPayload]);

        if (reviewError) {
          alert("Estabelecimento enviado para moderação, mas houve um erro ao enviar a avaliação.");
        } else {
          alert("Obrigado! Estabelecimento e avaliação enviados para moderação.");
        }
      } else {
        alert("Obrigado! Estabelecimento enviado para moderação.");
      }

      setSelectedPoint(null);
      setAddMode(false);
      loadAll();
      
    } catch (error: any) {
      alert(`Erro ao enviar: ${error.message || "Tente novamente."}`);
    }
  };

  const handleSubmitReviewForApproved = async (formData: ReviewFormData): Promise<void> => {
    if (!reviewTarget) {
      alert("Estabelecimento não selecionado.");
      return;
    }

    try {
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

      const { error } = await supabase
        .from("reviews")
        .insert([payload]);

      if (error) {
        alert(`Erro ao enviar avaliação: ${error.message}`);
        return;
      }

      alert("Avaliação enviada para moderação!");
      setReviewTarget(null);
      loadAll();
      
    } catch (error: any) {
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

  function getMapEstablishments(): Establishment[] {
    const filteredList = getFilteredList();
    
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

            {userLocation && (
              <button
                onClick={() => {
                  if (userLocation) {
                    setSelectedEstablishment({
                      id: "user-location",
                      name: "Sua localização",
                      address: "",
                      lat: userLocation.lat,
                      lng: userLocation.lng,
                      has_water: false,
                      has_bathroom: false,
                      has_power: false,
                      final_score: null,
                      reviews_count: 0
                    });
                  }
                }}
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
                title="Ir para minha localização"
              >
                📍
              </button>
            )}
          </div>

          {filtersExpanded && (
            <div style={{ 
              position: "absolute", 
              top: 12, 
              left: 12, 
              zIndex: 1001,
              background: "white", 
              borderRadius: 12, 
              padding: 16, 
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              width: 220,
              maxHeight: "calc(100vh - 100px)",
              overflow: "auto"
            }}>
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

          <LeafletMap
            establishments={getMapEstablishments()}
            selectedPoint={selectedPoint}
            onMapClick={handleMapClick}
            onRequestReview={handleRequestReview}
            onViewReviews={handleViewReviews}
            selectedEstablishment={selectedEstablishment}
            onEstablishmentOpened={() => setSelectedEstablishment(null)}
            showAddModal={addMode}
            onCloseAddModal={handleCloseAddModal}
            onSubmitAddModal={submitPendingEstablishmentAndOptionalReview}
            userLocation={userLocation}
            lastUpdate={lastUpdate}
          />
        </>
      )}

      {tab === "ranking" && <RankingList establishments={rankingMapped} reviews={reviews} />}

      <TabBar active={tab} onChange={(newTab: "map" | "ranking") => setTab(newTab)} />

      <ReviewPanel
        targetId={reviewTarget}
        onClose={handleCloseReviewPanel}
        onSubmit={handleSubmitReviewForApproved}
        reviews={reviews}
        establishments={establishments}
        initialView={reviewViewMode}
      />
    </div>
  );
}