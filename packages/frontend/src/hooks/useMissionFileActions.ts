import { useState, type RefObject } from "react";
import { toast } from "sonner";
import type mapboxgl from "mapbox-gl";
import { api } from "@/lib/api";
import { clearMissionDraft } from "@/store/missionDraft";
import { useMissionStore, type TemplateGroup } from "@/store/missionStore";
import { heightModeLabel } from "@/lib/units";
import type { UnitSystem } from "@droneroute/shared";
import type {
  MissionConfig,
  Waypoint,
  PointOfInterest,
  Obstacle,
  Building,
} from "@droneroute/shared";
import {
  buildPhotogrammetryExportRows,
  generatePhotogrammetryCsv,
} from "@/lib/photogrammetryExport";

interface UseMissionFileActionsArgs {
  missionName: string;
  missionClient: string;
  missionId: string | null;
  setMissionId: (id: string) => void;
  config: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  obstacles: Obstacle[];
  buildings: Building[];
  templateGroups: Record<string, TemplateGroup>;
  token: string | null;
  setShowAuthModal: (show: boolean) => void;
  setDirty: (dirty: boolean) => void;
  unitSystem: UnitSystem;
  mapRef: RefObject<mapboxgl.Map | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Every mission-level save/export/import/upload action, and their
 * in-flight loading flags — extracted out of App.tsx since none of this
 * logic touches rendering, it just orchestrates API calls against the
 * mission store's current snapshot. */
export function useMissionFileActions({
  missionName,
  missionClient,
  missionId,
  setMissionId,
  config,
  waypoints,
  pois,
  obstacles,
  buildings,
  templateGroups,
  token,
  setShowAuthModal,
  setDirty,
  unitSystem,
  mapRef,
  fileInputRef,
}: UseMissionFileActionsArgs) {
  const loadMission = useMissionStore((s) => s.loadMission);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingSegments, setExportingSegments] = useState(false);
  const [savingSegments, setSavingSegments] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [uploadingToDjiCloud, setUploadingToDjiCloud] = useState(false);
  const [uploadingSegmentsToDjiCloud, setUploadingSegmentsToDjiCloud] =
    useState(false);

  const handleSave = async () => {
    if (!token) {
      setShowAuthModal(true);
      return;
    }
    if (!missionName.trim()) {
      toast.warning("Před uložením zadejte název mise");
      return;
    }
    setSaving(true);
    try {
      if (missionId) {
        await api.put(`/missions/${missionId}`, {
          name: missionName,
          client: missionClient,
          config,
          waypoints,
          pois,
          obstacles,
          buildings,
          templateGroups,
        });
      } else {
        const result = await api.post<{ id: string }>("/missions", {
          name: missionName,
          client: missionClient,
          config,
          waypoints,
          pois,
          obstacles,
          buildings,
          templateGroups,
        });
        setMissionId(result.id);
      }
      setDirty(false);
      clearMissionDraft();
    } catch (err: any) {
      toast.error(`Uložení selhalo: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSegments = async () => {
    if (!token) {
      setShowAuthModal(true);
      return;
    }
    if (waypoints.length < 2) {
      toast.warning("Pro uložení segmentů je potřeba alespoň 2 body trasy");
      return;
    }
    if (!missionName.trim()) {
      toast.warning("Před uložením zadejte název mise");
      return;
    }

    setSavingSegments(true);
    try {
      const created = await api.post<{ id: string; name: string }[]>(
        "/missions/segments",
        {
          name: missionName,
          config,
          waypoints,
          pois,
          obstacles,
          buildings,
          templateGroups,
        },
      );
      toast.success(`Uloženo ${created.length} samostatných misí`);
    } catch (err: any) {
      toast.error(`Uložení segmentů selhalo: ${err.message}`);
    } finally {
      setSavingSegments(false);
    }
  };

  const handleExport = async () => {
    if (waypoints.length < 2) {
      toast.warning("Pro export je potřeba alespoň 2 body trasy");
      return;
    }

    setExporting(true);
    try {
      const blob = await api.post<Blob>("/kmz/generate", {
        name: missionName,
        config,
        waypoints,
        pois,
      });
      triggerDownload(
        blob,
        `${missionName.replace(/[^a-zA-Z0-9_-]/g, "_")}.kmz`,
      );
    } catch (err: any) {
      toast.error(`Export selhal: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSegments = async () => {
    if (waypoints.length < 2) {
      toast.warning("Pro export segmentů je potřeba alespoň 2 body trasy");
      return;
    }

    setExportingSegments(true);
    try {
      const blob = await api.post<Blob>("/kmz/generate-segments", {
        name: missionName,
        config,
        waypoints,
        pois,
      });
      triggerDownload(
        blob,
        `${missionName.replace(/[^a-zA-Z0-9_-]/g, "_")}-segments.zip`,
      );
    } catch (err: any) {
      toast.error(`Export segmentů selhal: ${err.message}`);
    } finally {
      setExportingSegments(false);
    }
  };

  const handleDownloadReport = async () => {
    if (waypoints.length < 2) {
      toast.warning("Pro report je potřeba alespoň 2 body trasy");
      return;
    }
    setGeneratingReport(true);
    try {
      // Dynamically imported: jsPDF (+ jspdf-autotable) pulls in ~400kb of
      // dependencies the app otherwise never needs, so it's excluded from
      // the main bundle and only fetched when a report is actually requested.
      const { generateMissionReportPdf } = await import("@/lib/pdfReport");
      const { captureMissionMapSnapshot } = await import("@/lib/pdfSnapshot");
      const boundsPoints: [number, number][] = [
        ...waypoints.map(
          (wp) => [wp.longitude, wp.latitude] as [number, number],
        ),
        ...pois.map((p) => [p.longitude, p.latitude] as [number, number]),
        ...obstacles.flatMap((o) =>
          o.vertices.map((v) => [v[1], v[0]] as [number, number]),
        ),
      ];
      const mapSnapshot = mapRef.current
        ? await captureMissionMapSnapshot(
            mapRef.current,
            boundsPoints,
            waypoints,
          )
        : undefined;
      const doc = generateMissionReportPdf({
        missionName,
        config,
        waypoints,
        unitSystem,
        mapSnapshot,
      });
      doc.save(`${missionName.replace(/[^a-zA-Z0-9_-]/g, "_")}-report.pdf`);
    } catch (err: any) {
      toast.error(`Vytvoření reportu selhalo: ${err.message}`);
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleExportPhotogrammetryCsv = () => {
    if (waypoints.length < 2) {
      toast.warning("Pro export je potřeba alespoň 2 body trasy");
      return;
    }
    const rows = buildPhotogrammetryExportRows(waypoints);
    if (rows.length === 0) {
      toast.warning(
        "Mise neobsahuje žádné akce fotografování (takePhoto) — export by byl prázdný. Nastavte šablony na režim Foto, ne Video.",
      );
      return;
    }
    const csv = generatePhotogrammetryCsv(waypoints);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    triggerDownload(
      blob,
      `${missionName.replace(/[^a-zA-Z0-9_-]/g, "_")}-pix4d-metashape.csv`,
    );
    toast.info(
      `Sloupec Altitude(m) je výška ${heightModeLabel(config.heightMode)}, ne nadmořská výška — než použijete export pro georeferencování, ověřte, že to odpovídá očekávání Pix4D/Metashape.`,
      { duration: 8000 },
    );
  };

  const handleUploadToDjiCloud = async () => {
    if (waypoints.length < 2) {
      toast.warning("Pro nahrání je potřeba alespoň 2 body trasy");
      return;
    }
    if (!token) {
      setShowAuthModal(true);
      return;
    }

    setUploadingToDjiCloud(true);
    try {
      const res = await api.post<{ waylineName: string }>("/dji-cloud/upload", {
        name: missionName,
        config,
        waypoints,
        pois,
      });
      toast.success(
        `Mise nahrána do DJI Cloud jako "${res.waylineName}" — najdete ji v Pilot 2 v záložce Cloud`,
      );
    } catch (err: any) {
      toast.error(`Nahrání do DJI Cloud selhalo: ${err.message}`);
    } finally {
      setUploadingToDjiCloud(false);
    }
  };

  const handleUploadSegmentsToDjiCloud = async () => {
    if (waypoints.length < 2) {
      toast.warning("Pro nahrání segmentů je potřeba alespoň 2 body trasy");
      return;
    }
    if (!token) {
      setShowAuthModal(true);
      return;
    }

    setUploadingSegmentsToDjiCloud(true);
    try {
      const res = await api.post<{ count: number }>(
        "/dji-cloud/upload-segments",
        {
          name: missionName,
          config,
          waypoints,
          pois,
        },
      );
      toast.success(
        `Nahráno ${res.count} segmentů do DJI Cloud — najdete je v Pilot 2 v záložce Cloud`,
      );
    } catch (err: any) {
      // On a partial failure the backend reports how many legs already
      // uploaded, so the user doesn't re-run and create duplicates.
      const partial = err?.body as
        | { uploaded?: number; total?: number }
        | undefined;
      if (partial?.uploaded && partial?.total) {
        toast.error(
          `Nahrávání segmentů do DJI Cloud selhalo — ${partial.uploaded} z ${partial.total} segmentů se ale už nahrálo (najdete je v Pilot 2 v záložce Cloud)`,
        );
      } else {
        toast.error(`Nahrání segmentů do DJI Cloud selhalo: ${err.message}`);
      }
    } finally {
      setUploadingSegmentsToDjiCloud(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const result = await api.post<{
        config: any;
        waypoints: any[];
        pois?: any[];
      }>("/kmz/import", formData);
      loadMission({
        name: file.name.replace(/\.kmz$/i, ""),
        config: result.config,
        waypoints: result.waypoints,
        pois: result.pois,
      });
    } catch (err: any) {
      toast.error(`Import selhal: ${err.message}`);
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return {
    saving,
    exporting,
    exportingSegments,
    savingSegments,
    generatingReport,
    uploadingToDjiCloud,
    uploadingSegmentsToDjiCloud,
    handleSave,
    handleSaveSegments,
    handleExport,
    handleExportSegments,
    handleDownloadReport,
    handleExportPhotogrammetryCsv,
    handleUploadToDjiCloud,
    handleUploadSegmentsToDjiCloud,
    handleImport,
  };
}
