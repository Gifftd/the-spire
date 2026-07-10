// ═══════════════════════════════════════════════════════════════
//  map-render.js — single source of truth for the pin palette.
//
//  Consumed by map.html (player Atlas) and map-dm.html (Atlas
//  Workshop). Load AFTER auth.js, BEFORE the page script:
//    <script src="map-render.js?v=1"></script>
//
//  Exposes window.MapRender:
//    TYPE_COLORS / TYPE_LABELS / TYPE_ICONS — the pin type palette
//    legendPinSVG(color)  — teardrop SVG for legends
//    injectPinCSS()       — writes the per-type .pin / .submap-pin
//                           color rules into a <style> tag so the
//                           palette lives in exactly one place.
//
//  Structural pin CSS (teardrop shape, ring, sizes) stays in each
//  page — only the type→color mapping is generated here.
// ═══════════════════════════════════════════════════════════════
(function () {
  const TYPE_COLORS = { city:'#3a6fd0', dungeon:'#c43838', wilderness:'#4ca050', ruin:'#a89478', port:'#16b5a0', fort:'#b060d0', shop:'#d4772f', tavern:'#8a5a3b', default:'#e0a830' };
  const TYPE_LABELS = { city:'City', dungeon:'Dungeon', wilderness:'Wilderness', ruin:'Ruin', port:'Port', fort:'Fort', shop:'Shop', tavern:'Tavern', default:'Location' };
  const TYPE_ICONS  = { city:'🏙', dungeon:'⚔', wilderness:'🌲', ruin:'🏚', port:'⚓', fort:'🏰', shop:'🪙', tavern:'🍺', default:'📍' };

  function legendPinSVG(color) {
    return `<svg class="legend-pin" viewBox="0 0 16 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 1 C4.1 1 1 4.1 1 8 C1 13 8 19 8 19 C8 19 15 13 15 8 C15 4.1 11.9 1 8 1 Z"
      fill="${color}" stroke="rgba(248,245,238,0.9)" stroke-width="1.4"/>
  </svg>`;
  }

  function injectPinCSS() {
    if (document.getElementById('map-render-pin-css')) return;
    const rules = Object.entries(TYPE_COLORS).map(([type, color]) =>
      `.pin.type-${type} .pin-marker,.pin.type-${type} .pin-tail,` +
      `.submap-pin.type-${type} .pin-marker,.submap-pin.type-${type} .pin-tail{background:${color}}`
    ).join('\n');
    const style = document.createElement('style');
    style.id = 'map-render-pin-css';
    style.textContent = rules;
    document.head.appendChild(style);
  }

  window.MapRender = { TYPE_COLORS, TYPE_LABELS, TYPE_ICONS, legendPinSVG, injectPinCSS };
})();
