/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import { Loader2 } from "lucide-react";

const actionButtonStyle = {
  border: "1px solid #52525b",
  borderRadius: "6px",
  background: "#27272a",
  color: "#f4f4f5",
  cursor: "pointer",
  padding: "4px 8px",
  fontSize: "12px",
};

export default function VideoPlayer({
  id,
  episodeNumOrId,
  season = 1,
  isDownloaded,
  episodes = [],
  episodesList = [],
  animeTitle = "",
  image = "",
  provider = "",
  malid = "",
  onBack,
  playerSubDub = "sub",
  subdub,
  type: propType = "Anime",
}) {
  const type =
    typeof id === "string" && (id.startsWith("tv:") || id.startsWith("movie:"))
      ? "Movies"
      : propType === "Movies"
        ? "Movies"
        : "Anime";

  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState("Initializing MPV player...");
  const [currentEpNumOrId, setCurrentEpNumOrId] = useState(episodeNumOrId);
  const [mpvStatus, setMpvStatus] = useState({
    running: false,
    connected: false,
    ready: false,
    started: false,
  });
  const [launchError, setLaunchError] = useState("");
  const [restartToken, setRestartToken] = useState(0);
  const [stopping, setStopping] = useState(false);
  // Bumped on every next/prev request so the launch effect re-fires even if
  // the episode state resolves to an unchanged launchKey (auto-next then
  // hangs on "Loading ..." forever without this).
  const [navToken, setNavToken] = useState(0);
  // Same-episode relaunch guard: identical params must not fire playInMpv
  // twice (double effect runs / rapid state churn spawned two players).
  const launchedRef = useRef(null);
  const startupTimerRef = useRef(null);
  const mountGenerationRef = useRef(0);
  const [currentSeason, setCurrentSeason] = useState(season);

  const refreshMpvStatus = async () => {
    try {
      const status = await window.sharedStateAPI?.getMpvStatus?.();
      if (status) setMpvStatus(status);
      return status;
    } catch {
      return null;
    }
  };

  const killCurrentMpv = async () => {
    const result = await window.sharedStateAPI?.killMpv?.();
    if (!result || result.success === false) {
      throw new Error(result?.error || "Failed to stop MPV player.");
    }
    return result;
  };

  const stopMpv = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      clearTimeout(startupTimerRef.current);
      await killCurrentMpv();
      setMpvStatus({
        running: false,
        connected: false,
        ready: false,
        started: false,
      });
      setLoading(false);
      setLaunchError("");
      setStatusMsg("MPV stopped.");
    } catch (err) {
      setLaunchError(err.message || "Failed to stop MPV player.");
    } finally {
      setStopping(false);
    }
  };

  const relaunchMpv = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      clearTimeout(startupTimerRef.current);
      await killCurrentMpv();
      launchedRef.current = null;
      setMpvStatus({
        running: false,
        connected: false,
        ready: false,
        started: false,
      });
      setLaunchError("");
      setLoading(true);
      setStatusMsg("Restarting MPV player...");
      setRestartToken((value) => value + 1);
    } catch (err) {
      setLaunchError(err.message || "Failed to restart MPV player.");
    } finally {
      setStopping(false);
    }
  };

  useEffect(() => {
    setCurrentEpNumOrId(episodeNumOrId);
    if (season !== undefined && season !== null) {
      setCurrentSeason(season);
    }
  }, [episodeNumOrId, season]);

  useEffect(() => {
    let cancelled = false;
    const pollStatus = async () => {
      try {
        const status = await window.sharedStateAPI?.getMpvStatus?.();
        if (!cancelled && status) setMpvStatus(status);
      } catch {}
    };
    pollStatus();
    const interval = setInterval(pollStatus, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const generation = ++mountGenerationRef.current;
    return () => {
      clearTimeout(startupTimerRef.current);
      setTimeout(() => {
        if (mountGenerationRef.current !== generation) return;
        const kill = window.sharedStateAPI?.killMpv?.();
        Promise.resolve(kill).catch(() => {});
      }, 0);
    };
  }, []);

  useEffect(() => {
    const isElectronMpvAvailable =
      typeof window !== "undefined" &&
      window.sharedStateAPI &&
      typeof window.sharedStateAPI.playInMpv === "function";

    if (!isElectronMpvAvailable) return;

    const allEpisodes = episodes.length > 0 ? episodes : episodesList;
    const sortedEpisodes = [...allEpisodes].sort((a, b) => {
      const seasonA = Number(a.season) || 1;
      const seasonB = Number(b.season) || 1;
      if (seasonA !== seasonB) return seasonA - seasonB;
      const numA = Number(a.number !== undefined ? a.number : a.id);
      const numB = Number(b.number !== undefined ? b.number : b.id);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return 0;
    });

    const activeSeason = currentSeason || season || 1;

    let currentEpisodeObj = sortedEpisodes.find(
      (item) =>
        String(item.id) === String(currentEpNumOrId) &&
        Number(item.season || 1) === Number(activeSeason),
    );

    if (!currentEpisodeObj) {
      currentEpisodeObj = sortedEpisodes.find(
        (item) => String(item.id) === String(currentEpNumOrId),
      );
    }

    if (!currentEpisodeObj) {
      currentEpisodeObj = sortedEpisodes.find(
        (item) =>
          Number(item.number) === Number(currentEpNumOrId) &&
          Number(item.season || 1) === Number(activeSeason),
      );
    }

    if (!currentEpisodeObj) {
      currentEpisodeObj = sortedEpisodes.find(
        (item) => Number(item.number) === Number(currentEpNumOrId),
      );
    }

    const targetEpId = currentEpisodeObj
      ? currentEpisodeObj.id
      : currentEpNumOrId;
    const targetEpNum = currentEpisodeObj
      ? currentEpisodeObj.number
      : typeof currentEpNumOrId === "number" ||
          (!isNaN(Number(currentEpNumOrId)) &&
            !String(currentEpNumOrId).includes("|"))
        ? Number(currentEpNumOrId)
        : 1;
    const targetSeason =
      currentEpisodeObj?.season !== undefined &&
      currentEpisodeObj?.season !== null
        ? Number(currentEpisodeObj.season)
        : Number(activeSeason) || 1;

    const currentIdx = sortedEpisodes.findIndex(
      (item) =>
        (String(item.id) === String(targetEpId) ||
          (Number(item.number) === Number(targetEpNum) &&
            Number(item.season || 1) === Number(targetSeason))) &&
        Number(item.season || 1) === Number(targetSeason),
    );
    const hasNext =
      currentIdx !== -1
        ? currentIdx < sortedEpisodes.length - 1
        : sortedEpisodes.some(
            (e) =>
              Number(e.season || 1) === Number(targetSeason) &&
              Number(e.number) > Number(targetEpNum),
          );
    const hasPrev =
      currentIdx !== -1 ? currentIdx > 0 : Number(targetEpNum) > 1;

    const isMovieType = type === "Movies";
    const epLabel =
      isMovieType && targetSeason > 1
        ? `Season ${targetSeason} Episode ${targetEpNum}`
        : `Episode ${targetEpNum}`;

    const handleNextEpisode = () => {
      let nextEp;
      if (currentIdx !== -1 && currentIdx < sortedEpisodes.length - 1) {
        nextEp = sortedEpisodes[currentIdx + 1];
      } else {
        nextEp = sortedEpisodes.find(
          (e) =>
            Number(e.season || 1) === Number(targetSeason) &&
            Number(e.number) > Number(targetEpNum),
        );
      }
      if (nextEp) {
        setLoading(true);
        const nextSeason = Number(nextEp.season || targetSeason || 1);
        const nextEpLabel =
          type === "Movies" && nextSeason > 1
            ? `Season ${nextSeason} Episode ${nextEp.number || nextEp.id}`
            : `Episode ${nextEp.number || nextEp.id}`;
        setStatusMsg(`Loading ${nextEpLabel}...`);
        setCurrentSeason(nextSeason);
        setCurrentEpNumOrId(nextEp.id || nextEp.number);
        setNavToken((value) => value + 1);
      } else if (onBack) {
        onBack();
      }
    };

    const handlePrevEpisode = () => {
      let prevEp = null;
      if (currentIdx > 0) {
        prevEp = sortedEpisodes[currentIdx - 1];
      } else {
        const prevCandidates = sortedEpisodes.filter(
          (e) =>
            Number(e.season || 1) === Number(targetSeason) &&
            Number(e.number) < Number(targetEpNum),
        );
        if (prevCandidates.length > 0) {
          prevEp = prevCandidates[prevCandidates.length - 1];
        }
      }
      if (prevEp) {
        setLoading(true);
        const prevSeason = Number(prevEp.season || targetSeason || 1);
        const prevEpLabel =
          type === "Movies" && prevSeason > 1
            ? `Season ${prevSeason} Episode ${prevEp.number || prevEp.id}`
            : `Episode ${prevEp.number || prevEp.id}`;
        setStatusMsg(`Loading ${prevEpLabel}...`);
        setCurrentSeason(prevSeason);
        setCurrentEpNumOrId(prevEp.id || prevEp.number);
        setNavToken((value) => value + 1);
      }
    };

    const removeMpvStartedListener = window.sharedStateAPI.on(
      "mpv-started",
      () => {
        clearTimeout(startupTimerRef.current);
        setLaunchError("");
        setLoading(false);
        setStatusMsg("MPV is running.");
        refreshMpvStatus();
      },
    );

    // Show overlay while backend fetches sources for next/prev episode
    const removeMpvLoadingListener = window.sharedStateAPI.on(
      "mpv-loading",
      (data) => {
        clearTimeout(startupTimerRef.current);
        setLoading(true);
        setStatusMsg(
          data?.episode
            ? `Fetching sources for Episode ${data.episode}...`
            : "Fetching episode sources...",
        );
      },
    );

    const removeMpvActionListener = window.sharedStateAPI.on(
      "mpv-action",
      (data) => {
        if (data?.action === "next") {
          handleNextEpisode();
        } else if (data?.action === "prev") {
          handlePrevEpisode();
        }
      },
    );

    const removeMpvCloseListener = window.sharedStateAPI.on(
      "mpv-closed",
      (data) => {
        clearTimeout(startupTimerRef.current);
        setLoading(false);
        if (data?.action === "next") {
          handleNextEpisode();
        } else if (data?.action === "prev") {
          handlePrevEpisode();
        } else if (onBack) {
          onBack();
        }
      },
    );

    const removeMpvErrorListener = window.sharedStateAPI.on(
      "mpv-error",
      (data) => {
        clearTimeout(startupTimerRef.current);
        const message = data?.message || "MPV player encountered an error.";
        setLaunchError(message);
        setLoading(false);
        setStatusMsg(message);
        refreshMpvStatus();
        Swal.fire({
          icon: "error",
          title: "MPV Player Error",
          text: message,
          background: "#18181b",
          color: "#fff",
          confirmButtonText: "OK",
        });
      },
    );

    const launchKey = `${id}|${targetEpId}|${subdub || playerSubDub}|${navToken}`;
    if (launchedRef.current !== launchKey) {
      launchedRef.current = launchKey;
      setLoading(true);
      setLaunchError("");
      setStatusMsg(`Opening MPV player for ${epLabel}...`);

      const launch = async () => {
        try {
          await refreshMpvStatus();
          const res = await window.sharedStateAPI.playInMpv({
            mediaId: id,
            episodeId: targetEpId,
            episode: targetEpNum,
            season: targetSeason,
            isDownloaded: !!isDownloaded,
            title: animeTitle,
            image: image,
            provider: provider,
            malid: type === "Movies" ? null : malid,
            subdub: subdub || playerSubDub,
            episodes: sortedEpisodes,
            hasNext,
            hasPrev,
            type: type || "Anime",
          });
          if (launchedRef.current !== launchKey) return;
          if (res?.aborted) return;
          if (res?.error) {
            setLaunchError(res.error);
            setLoading(false);
            setStatusMsg(res.error);
            refreshMpvStatus();
            Swal.fire({
              icon: "error",
              title: "MPV Launch Error",
              text: res.error,
              background: "#18181b",
              color: "#fff",
              confirmButtonText: "OK",
            });
            return;
          }
          if (res?.ipcConnected === false) {
            const message =
              "MPV started, but its control connection failed. Stop or restart it below.";
            setLaunchError(message);
            setLoading(false);
            setStatusMsg(message);
            refreshMpvStatus();
            return;
          }

          setStatusMsg("Waiting for MPV to begin playback...");
          clearTimeout(startupTimerRef.current);
          startupTimerRef.current = setTimeout(async () => {
            if (launchedRef.current !== launchKey) return;
            const status = await refreshMpvStatus();
            if (status?.started) return;
            const message = status?.running
              ? "MPV is running, but playback did not start. Stop or restart it below."
              : "MPV did not start. Launch it again below.";
            setLaunchError(message);
            setLoading(false);
            setStatusMsg(message);
          }, 20000);
        } catch (err) {
          if (launchedRef.current !== launchKey) return;
          const message = err.message || "Failed to launch MPV player.";
          setLaunchError(message);
          setLoading(false);
          setStatusMsg(message);
          refreshMpvStatus();
          Swal.fire({
            icon: "error",
            title: "MPV Launch Error",
            text: message,
            background: "#18181b",
            color: "#fff",
            confirmButtonText: "OK",
          });
        }
      };
      launch();
    }

    return () => {
      removeMpvStartedListener();
      removeMpvLoadingListener();
      removeMpvActionListener();
      removeMpvCloseListener();
      removeMpvErrorListener();
    };
  }, [
    id,
    currentEpNumOrId,
    currentSeason,
    playerSubDub,
    provider,
    restartToken,
    navToken,
  ]);

  return (
    <>
      {/* Top Animated Progress Bar & Backdrop Blocker */}
      <style>{`
        @keyframes topProgressPulse {
          0% { width: 0%; left: 0%; }
          50% { width: 70%; left: 15%; }
          100% { width: 100%; left: 0%; }
        }
        .mpv-top-progress-bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
          z-index: 99999;
          animation: topProgressPulse 1.5s infinite ease-in-out;
        }
        .mpv-blocker-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(4px);
          z-index: 99998;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: wait;
        }
        .mpv-blocker-card {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
          padding: 24px 32px;
          display: flex;
          align-items: center;
          gap: 16px;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
          color: #f4f4f5;
        }
      `}</style>
      {loading && (
        <>
          <div className="mpv-top-progress-bar" />
          <div className="mpv-blocker-overlay">
            <div className="mpv-blocker-card">
              <Loader2 className="animate-spin text-blue-500" size={28} />
              <div>
                <h4 style={{ margin: 0, fontWeight: 600, fontSize: "15px" }}>
                  Opening MPV Player
                </h4>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontSize: "13px",
                    color: "#a1a1aa",
                  }}
                >
                  {statusMsg}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
      <div
        role="status"
        style={{
          position: "fixed",
          top: "12px",
          right: "12px",
          zIndex: 100000,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 10px",
          border: "1px solid #3f3f46",
          borderRadius: "8px",
          background: "#18181b",
          color: "#f4f4f5",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          fontSize: "12px",
        }}
      >
        <span>
          {mpvStatus.running
            ? mpvStatus.started
              ? "MPV running"
              : "MPV running (starting)"
            : loading
              ? "MPV starting"
              : "MPV stopped"}
        </span>
        {launchError && (
          <span title={launchError} style={{ color: "#f87171" }}>
            !
          </span>
        )}
        {mpvStatus.running ? (
          <button
            type="button"
            onClick={stopMpv}
            disabled={stopping}
            style={actionButtonStyle}
          >
            Stop MPV
          </button>
        ) : loading ? (
          <button
            type="button"
            onClick={stopMpv}
            disabled={stopping}
            style={actionButtonStyle}
          >
            Cancel
          </button>
        ) : null}
        {(!loading || mpvStatus.running) && (
          <button
            type="button"
            onClick={relaunchMpv}
            disabled={stopping}
            style={actionButtonStyle}
          >
            {mpvStatus.running ? "Restart MPV" : "Launch MPV"}
          </button>
        )}
      </div>
    </>
  );
}
