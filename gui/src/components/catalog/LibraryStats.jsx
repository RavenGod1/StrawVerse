import { Clock, CheckSquare, Tv, BookOpen } from "lucide-react";

export default function LibraryStats({
  type,
  stats,
  provider,
  linkingMalItem,
}) {
  if (provider !== "local" || !stats || linkingMalItem) return null;

  return (
    <div className="library-stats-container">
      <div className="library-stat-card glass-panel">
        <div className="stat-icon-wrapper purple-glow">
          <Clock size={16} className="stat-icon" />
        </div>
        <div className="stat-content">
          <span className="stat-label">
            {type === "Anime" ? "Time Watched" : "Time Read"}
          </span>
          <span className="stat-value">
            {type === "Anime"
              ? `${stats.watchHours || 0} hrs`
              : `${stats.readHours || 0} hrs`}
          </span>
        </div>
      </div>

      <div className="library-stat-card glass-panel">
        <div className="stat-icon-wrapper green-glow">
          <CheckSquare size={16} className="stat-icon" />
        </div>
        <div className="stat-content">
          <span className="stat-label">
            {type === "Anime" ? "Episodes" : "Chapters"}
          </span>
          <span className="stat-value">
            {type === "Anime"
              ? `${stats.completedEpisodes || 0} eps`
              : `${stats.completedChapters || 0} chs`}
          </span>
        </div>
      </div>

      <div className="library-stat-card glass-panel">
        <div className="stat-icon-wrapper blue-glow">
          {type === "Anime" ? (
            <Tv size={16} className="stat-icon" />
          ) : (
            <BookOpen size={16} className="stat-icon" />
          )}
        </div>
        <div className="stat-content">
          <span className="stat-label">
            {type === "Anime" ? "Total Series" : "Total Titles"}
          </span>
          <span className="stat-value">
            {type === "Anime"
              ? `${stats.distinctAnime || 0} Anime`
              : `${stats.distinctManga || 0} Manga`}
          </span>
        </div>
      </div>
    </div>
  );
}
