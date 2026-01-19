const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const dataDir = path.join(__dirname, '..', 'data');
const rolesPath = path.join(dataDir, 'specialRoles.json');
const configPath = path.join(dataDir, 'specialRolesConfig.json');

const DEFAULT_ROLES_DATA = {
  roles: {},
  deleted: {}
};

const DEFAULT_CONFIG_DATA = {};

const cache = {
  roles: null,
  config: null,
  rolesDirty: false,
  configDirty: false,
  rolesSaveTimeout: null,
  configSaveTimeout: null,
  rolesByGuild: null,
  rolesIndexDirty: false
};

function ensureFile(filePath, defaultData) {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    }
  } catch (error) {
    console.error(`❌ خطأ في تهيئة الملف ${filePath}:`, error);
  }
}

function loadJson(filePath, defaultData) {
  try {
    ensureFile(filePath, defaultData);
    const data = fs.readFileSync(filePath, 'utf8');
    if (!data || data.trim() === '') return JSON.parse(JSON.stringify(defaultData));
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ خطأ في قراءة ${filePath}:`, error);
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function scheduleRolesSave() {
  cache.rolesDirty = true;
  if (cache.rolesSaveTimeout) clearTimeout(cache.rolesSaveTimeout);
  cache.rolesSaveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(rolesPath, JSON.stringify(cache.roles || DEFAULT_ROLES_DATA, null, 2));
      cache.rolesDirty = false;
    } catch (error) {
      console.error('❌ خطأ في حفظ بيانات الرولات الخاصة:', error);
    }
  }, 1500);
}

function scheduleConfigSave() {
  cache.configDirty = true;
  if (cache.configSaveTimeout) clearTimeout(cache.configSaveTimeout);
  cache.configSaveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(configPath, JSON.stringify(cache.config || DEFAULT_CONFIG_DATA, null, 2));
      cache.configDirty = false;
    } catch (error) {
      console.error('❌ خطأ في حفظ إعدادات الرولات الخاصة:', error);
    }
  }, 1500);
}

function getRolesData() {
  if (!cache.roles) {
    cache.roles = loadJson(rolesPath, DEFAULT_ROLES_DATA);
    if (!cache.roles.roles) cache.roles.roles = {};
    if (!cache.roles.deleted) cache.roles.deleted = {};
    cache.rolesIndexDirty = true;
  }
  return cache.roles;
}

function getConfigData() {
  if (!cache.config) {
    cache.config = loadJson(configPath, DEFAULT_CONFIG_DATA);
  }
  return cache.config;
}

function getGuildConfig(guildId) {
  const config = getConfigData();
  if (!config[guildId]) {
    config[guildId] = {
      managerRoleIds: [],
      managerUserIds: [],
      logChannelId: null,
      requestsChannelId: null,
      requestInboxChannelId: null,
      adminControlChannelId: null,
      memberControlChannelId: null,
      requestImage: null,
      adminImage: null,
      memberImage: null,
      topChannelId: null,
      topImage: null,
      topMessageId: null,
      topEnabled: false,
      activityResetAt: null,
      roleActivityResetAt: {}
    };
    scheduleConfigSave();
  }
  return config[guildId];
}

function updateGuildConfig(guildId, patch) {
  const config = getGuildConfig(guildId);
  Object.assign(config, patch);
  scheduleConfigSave();
  return config;
}

function addRoleEntry(roleId, entry) {
  const data = getRolesData();
  data.roles[roleId] = entry;
  cache.rolesIndexDirty = true;
  scheduleRolesSave();
  return data.roles[roleId];
}

function deleteRoleEntry(roleId, deletedBy) {
  const data = getRolesData();
  const entry = data.roles[roleId];
  if (!entry) return null;
  const deletedEntry = {
    ...entry,
    deletedAt: Date.now(),
    deletedBy
  };
  data.deleted[roleId] = deletedEntry;
  delete data.roles[roleId];
  cache.rolesIndexDirty = true;
  scheduleRolesSave();
  return deletedEntry;
}

function restoreRoleEntry(roleId) {
  const data = getRolesData();
  const entry = data.deleted[roleId];
  if (!entry) return null;
  const restored = {
    ...entry
  };
  delete restored.deletedAt;
  delete restored.deletedBy;
  data.roles[roleId] = restored;
  delete data.deleted[roleId];
  cache.rolesIndexDirty = true;
  scheduleRolesSave();
  return restored;
}

function rebuildRoleIndex() {
  const data = getRolesData();
  const index = {};
  for (const roleEntry of Object.values(data.roles)) {
    if (!index[roleEntry.guildId]) index[roleEntry.guildId] = [];
    index[roleEntry.guildId].push(roleEntry);
  }
  cache.rolesByGuild = index;
  cache.rolesIndexDirty = false;
}

function findRoleByOwner(guildId, ownerId) {
  const data = getRolesData();
  return Object.values(data.roles).find(role => role.guildId === guildId && role.ownerId === ownerId) || null;
}

function getGuildRoles(guildId) {
  if (!cache.rolesByGuild || cache.rolesIndexDirty) {
    rebuildRoleIndex();
  }
  return cache.rolesByGuild[guildId] ? [...cache.rolesByGuild[guildId]] : [];
}

function getRoleEntry(roleId) {
  const data = getRolesData();
  return data.roles[roleId] || null;
}

function getDeletedRoles(guildId) {
  const data = getRolesData();
  return Object.values(data.deleted).filter(role => role.guildId === guildId);
}

function isManager(member, config, botOwners = []) {
  if (!member) return false;
  if (botOwners.includes(member.id)) return true;
  if (member.guild.ownerId === member.id) return true;

  if (config.managerUserIds && config.managerUserIds.includes(member.id)) return true;

  if (config.managerRoleIds && config.managerRoleIds.length > 0) {
    return member.roles.cache.some(role => config.managerRoleIds.includes(role.id));
  }
  return false;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0 د';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours} س ${minutes} د`;
  return `${minutes} د`;
}

function getResetDate(activityResetAt) {
  if (!activityResetAt) return null;
  return moment(activityResetAt).tz('Asia/Riyadh').format('YYYY-MM-DD');
}

function getRoleResetDate(guildConfig, roleId) {
  if (!guildConfig) return null;
  const roleReset = guildConfig.roleActivityResetAt?.[roleId] || null;
  return getResetDate(roleReset || guildConfig.activityResetAt);
}

module.exports = {
  getRolesData,
  getConfigData,
  getGuildConfig,
  updateGuildConfig,
  addRoleEntry,
  deleteRoleEntry,
  restoreRoleEntry,
  findRoleByOwner,
  getGuildRoles,
  getRoleEntry,
  getDeletedRoles,
  isManager,
  formatDuration,
  getResetDate,
  getRoleResetDate,
  rolesPath,
  configPath
};
