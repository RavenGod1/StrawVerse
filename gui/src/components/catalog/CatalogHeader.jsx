import { Search } from "lucide-react";

export default function CatalogHeader({
  provider,
  type,
  discoverTab,
  onSubTabChange,
  linkingMalItem,
  searchQuery,
  onSearchQueryChange,
  onSearchSubmit,
  onTypeChange,
  showTypeToggle = true,
  catalogSource = "mal",
  installedProviders = [],
  activeProvider = "",
  onProviderChange,
}) {
  // Discover only: a provider picker sitting directly left of the
  // Anime/Manga toggle, listing the extensions installed for this type.
  const providerChoices = Array.isArray(installedProviders)
    ? [...installedProviders]
    : [];
  if (activeProvider && !providerChoices.includes(activeProvider)) {
    providerChoices.unshift(activeProvider);
  }
  const showProviderPicker =
    provider === "provider" &&
    typeof onProviderChange === "function" &&
    providerChoices.length > 1;

  const providerLabel = (value) => {
    const clean = String(value).replace(/^@/, "");
    if (!clean.includes("/")) return clean;
    const [owner, name] = clean.split("/");
    return `${name} (@${owner})`;
  };

  return (
    <header className="catalog-header">
      <div className="header-left-section">
        {provider === "local" && <h1 className="catalog-title">Home</h1>}
        {provider === "provider" && <h1 className="catalog-title">Discover</h1>}
        {provider === "mal" && <h1 className="catalog-title">Filters</h1>}
        {provider === "provider" && type === "Anime" && (
          <div className="discover-sub-tabs">
            <button
              onClick={() => onSubTabChange && onSubTabChange("latest")}
              className={`discover-sub-tab ${discoverTab === "latest" ? "active" : ""}`}
            >
              Latest
            </button>
            <button
              onClick={() => onSubTabChange && onSubTabChange("calendar")}
              className={`discover-sub-tab ${discoverTab === "calendar" ? "active" : ""}`}
            >
              Airing Calendar
            </button>
          </div>
        )}
      </div>

      <div className="header-search-section">
        <div className="search-and-filter-wrapper">
          <form onSubmit={onSearchSubmit} className="search-form">
            <input
              type="text"
              placeholder={
                provider === "mal" && catalogSource?.startsWith("unique:")
                  ? `Search unmapped ${type.toLowerCase()}...`
                  : `Search ${type}...`
              }
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="search-input"
            />
            <button type="submit" className="btn-search">
              <Search size={18} />
            </button>
          </form>
        </div>
      </div>

      <div className="header-right-section">
        {showProviderPicker && (
          <select
            className="discover-provider-select"
            value={activeProvider || providerChoices[0]}
            onChange={(e) => onProviderChange(e.target.value)}
            aria-label="Change active provider"
            title="Choose which extension provider Discover uses"
          >
            {providerChoices.map((value) => (
              <option key={value} value={value}>
                {providerLabel(value)}
              </option>
            ))}
          </select>
        )}

        {showTypeToggle && (
          <div className="market-tabs-wrapper">
            <button
              type="button"
              onClick={() => onTypeChange && onTypeChange("Anime")}
              className={`market-tab-btn ${type === "Anime" ? "active" : ""}`}
            >
              Anime
            </button>
            <button
              type="button"
              onClick={() => onTypeChange && onTypeChange("Manga")}
              className={`market-tab-btn ${type === "Manga" ? "active" : ""}`}
            >
              Manga
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
