/** 公会花册（静态部署）只读逻辑，与 static/app.js 展示规则一致；花名与拥有记录为同一套数据，花坊图鉴为子集。 */

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function getMemberNick(data, memberId) {
  const meta = (data.members || {})[memberId];
  const nick = meta && typeof meta.displayName === "string" ? meta.displayName.trim() : "";
  return nick;
}

function formatMemberLabel(data, memberId) {
  const nick = getMemberNick(data, memberId);
  if (nick && nick !== memberId) return `${nick}（${memberId}）`;
  return memberId;
}

function memberMatchesKeyword(data, memberId, keywordLower) {
  if (!keywordLower) return true;
  if (String(memberId).toLowerCase().includes(keywordLower)) return true;
  const nick = getMemberNick(data, memberId);
  return nick.toLowerCase().includes(keywordLower);
}

function getAllFlowerNames(data) {
  return Object.keys(data.flowers || {});
}

function getAllMemberIds(data) {
  const set = new Set();
  Object.values(data.flowers || {}).forEach(owners => {
    (owners || []).forEach(o => set.add(o));
  });
  return Array.from(set).sort();
}

function getOwnersOfFlower(data, flowerName) {
  return (data.flowers || {})[flowerName] || [];
}

function getFlowersOfMember(data, memberId) {
  const result = [];
  Object.entries(data.flowers || {}).forEach(([flower, owners]) => {
    if ((owners || []).includes(memberId)) result.push(flower);
  });
  return result;
}

function getWorkshopCatalogNames(data) {
  const c = data.workshopCatalog;
  if (!Array.isArray(c)) return [];
  const set = new Set();
  c.forEach(x => {
    if (typeof x === "string" && x.trim()) set.add(x.trim());
  });
  return Array.from(set).sort();
}

function getOwnersOfWorkshopFlower(data, flowerName) {
  return getOwnersOfFlower(data, flowerName);
}

function getWorkshopFlowersOfMember(data, memberId) {
  const cat = new Set(getWorkshopCatalogNames(data));
  if (cat.size === 0) return [];
  return getFlowersOfMember(data, memberId).filter(f => cat.has(f));
}

/** 花坊立绘 URL（根路径） */
function getWorkshopFlowerImageUrl(data, name) {
  const rel = (data.workshopFlowerImages || {})[name];
  if (!rel || typeof rel !== "string") return "";
  return rel.startsWith("/") ? rel : `/${rel}`;
}

/** 花朵配图：优先本会 flowerImages，否则回落 workshopFlowerImages */
function getFlowerPortraitUrl(data, name) {
  const fi = (data.flowerImages || {})[name];
  if (fi && typeof fi === "string") {
    const v = fi.trim().replace(/^\/+/, "").replace(/\\/g, "/");
    if (v && !v.includes("..") && v.startsWith("flower-images/")) {
      return v.startsWith("/") ? v : `/${v}`;
    }
  }
  return getWorkshopFlowerImageUrl(data, name);
}

function getFlowerPortraitUrlBusted(data, name) {
  const base = getFlowerPortraitUrl(data, name);
  if (!base) return "";
  const epoch = Number(data && data.flowerPortraitEpoch) || 0;
  return epoch ? `${base}${base.includes("?") ? "&" : "?"}v=${epoch}` : base;
}

/** 成员拥有记录里、未列入花坊图鉴子集的花「种」数；图鉴为空时返回 null。 */
function getNonWorkshopFlowerKindCount(data, memberId) {
  const names = getWorkshopCatalogNames(data);
  if (names.length === 0) return null;
  const cat = new Set(names);
  return getFlowersOfMember(data, memberId).filter(f => !cat.has(f)).length;
}

/**
 * 将「花名 -> 拥有者 ID 数组」规整为去重 ID 列表，并补全 members 占位。
 */
function _cleanFlowerMap(rawMap, membersOut) {
  const result = {};
  for (const [fname, owners] of Object.entries(rawMap)) {
    if (!Array.isArray(owners)) continue;
    const ids = [];
    const seen = new Set();
    for (const o of owners) {
      const mid = String(o == null ? "" : o).trim();
      if (!mid || seen.has(mid)) continue;
      seen.add(mid);
      ids.push(mid);
      if (!(mid in membersOut)) membersOut[mid] = { displayName: mid };
      else {
        const meta = membersOut[mid];
        if (!meta || typeof meta !== "object") membersOut[mid] = { displayName: mid };
        else if (typeof meta.displayName !== "string" || !meta.displayName.trim()) meta.displayName = mid;
      }
    }
    result[fname] = ids;
  }
  return result;
}

/**
 * 规整花册数据：兼容仅有 flowers、无 members 的 data.json（与录入端导出一致）。
 */
function normalizeGalleryData(obj) {
  if (!obj || typeof obj !== "object") throw new Error("数据格式错误");
  const flowers = obj.flowers && typeof obj.flowers === "object" ? obj.flowers : {};
  const workshopSrc = obj.workshopFlowers && typeof obj.workshopFlowers === "object" ? obj.workshopFlowers : {};
  const members = obj.members && typeof obj.members === "object" ? { ...obj.members } : {};
  const out = { ...obj, flowers: {}, workshopFlowers: {}, members };

  out.flowers = _cleanFlowerMap(flowers, out.members);

  const cat = new Set();
  const wc = obj.workshopCatalog;
  if (Array.isArray(wc)) {
    wc.forEach(x => {
      if (typeof x === "string" && x.trim()) cat.add(x.trim());
    });
  }
  Object.keys(workshopSrc).forEach(k => {
    if (typeof k === "string" && k.trim()) cat.add(k.trim());
  });
  out.workshopCatalog = Array.from(cat).sort();
  out.workshopFlowers = {};

  const imgs = {};
  const rawImg = obj.workshopFlowerImages && typeof obj.workshopFlowerImages === "object" ? obj.workshopFlowerImages : {};
  Object.entries(rawImg).forEach(([k, v]) => {
    if (typeof k !== "string" || !k.trim()) return;
    if (typeof v !== "string" || !v.trim()) return;
    const vn = v.trim().replace(/^\/+/, "").replace(/\\/g, "/");
    if (vn.includes("..") || !vn.startsWith("workshop-images/")) return;
    imgs[k.trim()] = vn;
  });
  out.workshopFlowerImages = imgs;

  const fImgs = {};
  const rawFlowerImg = obj.flowerImages && typeof obj.flowerImages === "object" ? obj.flowerImages : {};
  Object.entries(rawFlowerImg).forEach(([k, v]) => {
    if (typeof k !== "string" || !k.trim()) return;
    if (typeof v !== "string" || !v.trim()) return;
    const vn = v.trim().replace(/^\/+/, "").replace(/\\/g, "/");
    if (vn.includes("..") || !vn.startsWith("flower-images/")) return;
    fImgs[k.trim()] = vn;
  });
  out.flowerImages = fImgs;

  try {
    out.flowerPortraitEpoch = Math.max(0, parseInt(obj.flowerPortraitEpoch, 10) || 0);
  } catch (e) {
    out.flowerPortraitEpoch = 0;
  }

  if (out.version == null) out.version = 2;
  return out;
}

async function loadGalleryData() {
  try {
    const r = await fetch("/api/data", { cache: "no-store" });
    if (r.ok) {
      const obj = await r.json();
      return normalizeGalleryData(obj);
    }
  } catch (_) {
    /* 无 Flask 或网络错误时继续尝试 data.json */
  }
  const res = await fetch("data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`无法加载 data.json（HTTP ${res.status}）`);
  const obj = await res.json();
  return normalizeGalleryData(obj);
}
