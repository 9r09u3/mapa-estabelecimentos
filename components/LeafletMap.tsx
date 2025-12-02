"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import AddEstablishmentModal from "./AddEstablishmentModal";

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

interface LeafletMapProps {
  establishments?: Establishment[];
  selectedPoint?: Position | null;
  onMapClick?: (pos: Position) => void;
  onRequestReview?: (id: string) => void;
  onViewReviews?: (id: string) => void;
  selectedEstablishment?: Establishment | null;
  onEstablishmentOpened?: () => void;
  showAddModal?: boolean;
  onCloseAddModal?: () => void;
  onSubmitAddModal?: (
    name: string, 
    address: string, 
    flags: { has_water: boolean; has_bathroom: boolean; has_power: boolean }, 
    wantToReview: boolean, 
    reviewData?: any
  ) => Promise<void>;
  userLocation?: Position | null;
  lastUpdate?: number;
}

interface MapControllerProps {
  selectedEstablishment?: Establishment | null;
  onEstablishmentOpened?: () => void;
  selectedPoint?: Position | null;
  onOpenAddModal?: () => void;
  userLocation?: Position | null;
}

interface MapClickHandlerProps {
  onMapClick?: (pos: Position) => void;
}

if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  });
}

const createUserLocationIcon = () => {
  return L.divIcon({
    className: "user-location-marker",
    html: `<div style="
      background: #3b82f6;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 20px;
      font-weight: 700;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5);
      border: 3px solid white;
      animation: pulse 2s infinite;
    ">
      <div style="
        background: white;
        width: 12px;
        height: 12px;
        border-radius: 50%;
      "></div>
    </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });
};

if (typeof window !== "undefined") {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
      }
    }
  `;
  document.head.appendChild(style);
}

function MapController({ 
  selectedEstablishment, 
  onEstablishmentOpened,
  selectedPoint,
  onOpenAddModal,
  userLocation
}: MapControllerProps) {
  const map = useMap();
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const openEstablishmentPopup = useCallback(async (establishment: Establishment) => {
    if (!establishment) return;
    
    const { lat, lng, id } = establishment;
    
    if (lastSelectedId === id) return;
    
    setLastSelectedId(id);

    map.flyTo([lat, lng], 17, {
      duration: 1,
      easeLinearity: 0.25
    });

    await new Promise(resolve => setTimeout(resolve, 800));

    const markerElement = findMarkerElement(id);
    
    if (markerElement) {
      simulateClick(markerElement);
      
      setTimeout(() => {
        onEstablishmentOpened?.();
      }, 500);
    } else {
      createManualPopup(establishment);
      onEstablishmentOpened?.();
    }
  }, [map, lastSelectedId, onEstablishmentOpened]);

  const findMarkerElement = (establishmentId: string) => {
    const markers = document.querySelectorAll('.leaflet-marker-icon');
    for (const marker of markers) {
      const markerId = marker.getAttribute('data-establishment-id');
      if (markerId === establishmentId) {
        return marker;
      }
    }
    return null;
  };

  const simulateClick = (element: Element) => {
    const event = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    element.dispatchEvent(event);
  };

  const createManualPopup = (establishment: Establishment) => {
    const { lat, lng, name, address, final_score, reviews_count, has_water, has_bathroom, has_power, id } = establishment;
    
    const facilities = [
      has_water ? "💧 Água" : "",
      has_bathroom ? "🚻 Banheiro" : "",
      has_power ? "🔌 Tomada" : "",
    ].filter(Boolean).join(" • ") || "Sem infraestrutura registrada";

    const popupContent = `
      <div style="min-width: 240px; font-family: system-ui, sans-serif;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px;">
          <div style="flex: 1;">
            <strong style="font-size: 16px; display: block; margin-bottom: 4px;">${name}</strong>
            <div style="font-size: 13px; color: #6b7280; margin-bottom: 8px;">${address || ''}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 700; font-size: 18px;">${final_score ? final_score.toFixed(1) : "—"}</div>
            <div style="font-size: 11px; color: #6b7280;">${reviews_count || 0} avaliações</div>
          </div>
        </div>
        
        <div style="font-size: 14px; color: #555; margin-bottom: 12px;">${facilities}</div>
        
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button 
            onclick="window.dispatchEvent(new CustomEvent('requestReview', { detail: '${id}' }))"
            style="
              padding: 10px 16px;
              background: #ff8c42;
              color: white;
              border: none;
              border-radius: 8px;
              font-weight: 700;
              width: 100%;
              cursor: pointer;
              font-size: 14px;
            "
          >
            📝 Avaliar este local
          </button>
          
          <button 
            onclick="window.dispatchEvent(new CustomEvent('viewReviews', { detail: '${id}' }))"
            style="
              padding: 10px 16px;
              background: #3b82f6;
              color: white;
              border: none;
              border-radius: 8px;
              font-weight: 700;
              width: 100%;
              cursor: pointer;
              font-size: 14px;
            "
          >
            👁️ Ver avaliações (${reviews_count || 0})
          </button>
        </div>
      </div>
    `;

    L.popup()
      .setLatLng([lat, lng])
      .setContent(popupContent)
      .openOn(map);
  };

  const createAddEstablishmentPopup = useCallback(() => {
    if (!selectedPoint) return;

    const popupContent = `
      <div style="min-width: 240px; font-family: system-ui, sans-serif;">
        <div style="text-align: center; margin-bottom: 16px;">
          <div style="font-size: 18px; font-weight: 700; color: #374151; margin-bottom: 4px;">Adicionar Estabelecimento</div>
          <div style="font-size: 12px; color: #6b7280;">Clique no botão abaixo para adicionar um novo estabelecimento nesta localização</div>
        </div>
        
        <button 
          onclick="window.dispatchEvent(new CustomEvent('openAddModal'))"
          style="
            padding: 12px 16px;
            background: #ff8c42;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 700;
            width: 100%;
            cursor: pointer;
            font-size: 14px;
            margin-bottom: 8px;
          "
        >
          ➕ Adicionar Estabelecimento
        </button>
        
        <button 
          onclick="window.dispatchEvent(new CustomEvent('closeAddPopup'))"
          style="
            padding: 12px 16px;
            background: #f3f4f6;
            color: #374151;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-weight: 600;
            width: 100%;
            cursor: pointer;
            font-size: 14px;
          "
        >
          Cancelar
        </button>
      </div>
    `;

    L.popup()
      .setLatLng([selectedPoint.lat, selectedPoint.lng])
      .setContent(popupContent)
      .openOn(map);
  }, [map, selectedPoint]);

  useEffect(() => {
    if (selectedEstablishment) {
      if (selectedEstablishment.id === "user-location") {
        map.flyTo([selectedEstablishment.lat, selectedEstablishment.lng], 16, {
          duration: 1,
          easeLinearity: 0.25
        });
      } else {
        openEstablishmentPopup(selectedEstablishment);
      }
    }
  }, [selectedEstablishment, openEstablishmentPopup, map]);

  useEffect(() => {
    if (selectedPoint) {
      createAddEstablishmentPopup();
    }
  }, [selectedPoint, createAddEstablishmentPopup]);

  useEffect(() => {
    if (userLocation && map) {
      const timer = setTimeout(() => {
        map.setView([userLocation.lat, userLocation.lng], 14);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [userLocation, map]);

  return null;
}

function createDivIcon(color: string, label?: string, size = 28): L.DivIcon {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background:${color};
      width:${size}px;
      height:${size}px;
      border-radius:50%;
      display:flex;
      align-items:center;
      justify-content:center;
      color:white;
      font-size:12px;
      font-weight:700;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      border: 2px solid white;
    ">${label ?? ""}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function colorByScore(avg: number | null): string {
  if (avg === null) return "#64748b";
  if (avg < 2.5) return "#ef4444";
  if (avg < 4) return "#f59e0b";
  return "#10b981";
}

function MapClickHandler({ onMapClick }: MapClickHandlerProps) {
  useMapEvents({
    click(e: L.LeafletMouseEvent) {
      onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

declare global {
  interface Window {
    dispatchEvent(event: CustomEvent): void;
  }
}

interface RequestReviewEvent extends CustomEvent {
  detail: string;
}

interface ViewReviewsEvent extends CustomEvent {
  detail: string;
}

interface OpenAddModalEvent extends CustomEvent {}
interface CloseAddPopupEvent extends CustomEvent {}

export default function LeafletMap({
  establishments = [],
  selectedPoint,
  onMapClick,
  onRequestReview,
  onViewReviews,
  selectedEstablishment,
  onEstablishmentOpened,
  showAddModal = false,
  onCloseAddModal,
  onSubmitAddModal,
  userLocation,
  lastUpdate,
}: LeafletMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [localShowAddModal, setLocalShowAddModal] = useState(false);
  const [markersKey, setMarkersKey] = useState(0);

  useEffect(() => {
    const handleReviewRequest = (event: Event) => {
      const customEvent = event as RequestReviewEvent;
      onRequestReview?.(customEvent.detail);
    };

    const handleViewReviews = (event: Event) => {
      const customEvent = event as ViewReviewsEvent;
      onViewReviews?.(customEvent.detail);
    };

    const handleOpenAddModal = (event: Event) => {
      event.preventDefault();
      setLocalShowAddModal(true);
    };

    const handleCloseAddPopup = (event: Event) => {
      event.preventDefault();
      if (mapRef.current) {
        mapRef.current.closePopup();
      }
      onCloseAddModal?.();
    };

    window.addEventListener('requestReview', handleReviewRequest);
    window.addEventListener('viewReviews', handleViewReviews);
    window.addEventListener('openAddModal', handleOpenAddModal);
    window.addEventListener('closeAddPopup', handleCloseAddPopup);
    
    return () => {
      window.removeEventListener('requestReview', handleReviewRequest);
      window.removeEventListener('viewReviews', handleViewReviews);
      window.removeEventListener('openAddModal', handleOpenAddModal);
      window.removeEventListener('closeAddPopup', handleCloseAddPopup);
    };
  }, [onRequestReview, onViewReviews, onCloseAddModal]);

  useEffect(() => {
    setLocalShowAddModal(showAddModal);
  }, [showAddModal]);

  useEffect(() => {
    if (lastUpdate) {
      setMarkersKey(prev => prev + 1);
    }
  }, [lastUpdate]);

  useEffect(() => {
    if (isMapReady && mapRef.current) {
    }
  }, [isMapReady]);

  const clusterOptions = {
    chunkedLoading: true,
    maxClusterRadius: 70,
    showCoverageOnHover: false,
    iconCreateFunction: function (cluster: any) {
      const count = cluster.getChildCount();
      const size = count < 10 ? 34 : count < 100 ? 42 : 52;
      const color = "#bbbbbbff";
      const html = `<div style="
        background:${color};
        width:${size}px;
        height:${size}px;
        border-radius:50%;
        display:flex;
        align-items:center;
        justify-content:center;
        color:white;
        font-size:${count < 10 ? 16 : 14}px;
        font-weight:700;
        box-shadow: 0 4px 8px rgba(255,140,66,0.3);
        border: 2px solid white;
      ">${count}</div>`;
      return L.divIcon({
        html,
        className: "cluster-marker",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    },
  };

  const MapReadyHandler = () => {
    const map = useMap();
    
    useEffect(() => {
      mapRef.current = map;
      setIsMapReady(true);
      
      return () => {
        setIsMapReady(false);
      };
    }, [map]);
    
    return null;
  };

  const handleCloseModal = () => {
    setLocalShowAddModal(false);
    onCloseAddModal?.();
    if (mapRef.current) {
      mapRef.current.closePopup();
    }
  };

  const handleConfirmModal = async (
    name: string, 
    address: string, 
    flags: { has_water: boolean; has_bathroom: boolean; has_power: boolean }, 
    wantToReview: boolean, 
    reviewData?: any
  ) => {
    if (onSubmitAddModal) {
      await onSubmitAddModal(name, address, flags, wantToReview, reviewData);
      setLocalShowAddModal(false);
      if (mapRef.current) {
        mapRef.current.closePopup();
      }
    }
  };

  return (
    <>
      <MapContainer
        center={[-16.6869, -49.2648]}
        zoom={13}
        style={{ height: "100vh", width: "100%" }}
        zoomControl={false}
        ref={mapRef}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        <MapReadyHandler />

        <MapClickHandler onMapClick={onMapClick} />
        
        <MapController 
          selectedEstablishment={selectedEstablishment} 
          onEstablishmentOpened={onEstablishmentOpened}
          selectedPoint={selectedPoint}
          userLocation={userLocation}
        />

        <div className="leaflet-top leaflet-right">
          <div className="leaflet-control-zoom leaflet-bar leaflet-control">
            <a 
              className="leaflet-control-zoom-in" 
              href="#" 
              title="Zoom in"
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.preventDefault();
                mapRef.current?.zoomIn();
              }}
            >
              +
            </a>
            <a 
              className="leaflet-control-zoom-out" 
              href="#" 
              title="Zoom out"
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.preventDefault();
                mapRef.current?.zoomOut();
              }}
            >
              −
            </a>
          </div>
        </div>

        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={createUserLocationIcon()}
          >
            <Popup>
              <div style={{ padding: 8 }}>
                <strong style={{ fontSize: 14 }}>Sua localização</strong>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  Você está aqui!
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {selectedPoint && (
          <Marker
            position={[selectedPoint.lat, selectedPoint.lng]}
            icon={createDivIcon("#f59e0b", "📍", 32)}
          />
        )}

        <MarkerClusterGroup {...clusterOptions} key={markersKey}>
          {establishments.map((establishment: Establishment) => {
            const { id, lat, lng, name, address, final_score, reviews_count, has_water, has_bathroom, has_power } = establishment;
            
            if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

            const color = colorByScore(final_score);
            const markerIcon = createDivIcon(color, final_score ? final_score.toFixed(1) : "?", 32);

            const facilities = [
              has_water ? "💧 Água" : "",
              has_bathroom ? "🚻 Banheiro" : "",
              has_power ? "🔌 Tomada" : "",
            ].filter(Boolean).join(" • ") || "Sem infraestrutura registrada";

            return (
              <Marker
                key={`${id}-${lastUpdate}`}
                position={[lat, lng]}
                icon={markerIcon}
                data-establishment-id={id}
              >
                <Popup>
                  <div style={{ minWidth: 240, fontFamily: "system-ui, sans-serif" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: 16, display: "block", marginBottom: 4 }}>{name}</strong>
                        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>{address}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontSize: 18 }}>{final_score ? final_score.toFixed(1) : "—"}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>{reviews_count || 0} avaliações</div>
                      </div>
                    </div>

                    <div style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>{facilities}</div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <button
                        onClick={() => onRequestReview?.(id)}
                        style={{
                          padding: "10px 16px",
                          background: "#ff8c42",
                          color: "white",
                          border: "none",
                          borderRadius: 8,
                          fontWeight: 700,
                          width: "100%",
                          cursor: "pointer",
                          fontSize: 14
                        }}
                      >
                        📝 Avaliar este local
                      </button>
                      
                      <button
                        onClick={() => onViewReviews?.(id)}
                        style={{
                          padding: "10px 16px",
                          background: "#3b82f6",
                          color: "white",
                          border: "none",
                          borderRadius: 8,
                          fontWeight: 700,
                          width: "100%",
                          cursor: "pointer",
                          fontSize: 14
                        }}
                      >
                        👁️ Ver avaliações ({reviews_count || 0})
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>

      {localShowAddModal && selectedPoint && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000
        }} onClick={handleCloseModal}>
          <div style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            maxWidth: 500,
            width: "90%",
            maxHeight: "90vh",
            overflow: "auto"
          }} onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}>
            <AddEstablishmentModal
              clickedPos={selectedPoint}
              onCancel={handleCloseModal}
              onConfirm={handleConfirmModal}
            />
          </div>
        </div>
      )}
    </>
  );
}