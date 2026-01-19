const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { getDatabase } = require('./database.js');

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
  rolesIndexDirty: false,
  dbInitialized: false
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
    persistRolesToDatabase().catch(() => {});
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
    persistConfigToDatabase().catch(() => {});
  }, 1500);
}

async function ensureDbTables() {
  const dbManager = getDatabase();
  if (!dbManager || !dbManager.isInitialized || cache.dbInitialized) return;
  await dbManager.run(`CREATE TABLE IF NOT EXISTS special_roles (
    role_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at INTEGER,
    created_by TEXT,
    name TEXT,
    color TEXT,
    icon TEXT,
    max_members INTEGER
  )`);
  await dbManager.run(`CREATE TABLE IF NOT EXISTS special_roles_deleted (
    role_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at INTEGER,
    created_by TEXT,
    name TEXT,
    color TEXT,
    icon TEXT,
    max_members INTEGER,
    deleted_at INTEGER,
    deleted_by TEXT
  )`);
  await dbManager.run(`CREATE TABLE IF NOT EXISTS special_roles_config (
    guild_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL
  )`);
  await dbManager.run('CREATE INDEX IF NOT EXISTS idx_special_roles_guild_id ON special_roles(guild_id)');
  cache.dbInitialized = true;
}

async function loadRolesFromDatabase() {
  const dbManager = getDatabase();
  if (!dbManager || !dbManager.isInitialized) return null;
  await ensureDbTables();
  const roles = await dbManager.all('SELECT * FROM special_roles');
  const deleted = await dbManager.all('SELECT * FROM special_roles_deleted');
  return {
    roles: roles.reduce((acc, row) => {
      acc[row.role_id] = {
        roleId: row.role_id,
        guildId: row.guild_id,
        ownerId: row.owner_id,
        createdAt: row.created_at,
        createdBy: row.created_by,
        name: row.name,
        color: row.color,
        icon: row.icon,
        maxMembers: row.max_members
      };
      return acc;
    }, {}),
    deleted: deleted.reduce((acc, row) => {
      acc[row.role_id] = {
        roleId: row.role_id,
        guildId: row.guild_id,
        ownerId: row.owner_id,
        createdAt: row.created_at,
        createdBy: row.created_by,
        name: row.name,
        color: row.color,
        icon: row.icon,
        maxMembers: row.max_members,
        deletedAt: row.deleted_at,
        deletedBy: row.deleted_by
      };
      return acc;
    }, {})
  };
}

async function loadConfigFromDatabase() {
  const dbManager = getDatabase();
  if (!dbManager || !dbManager.isInitialized) return null;
  await ensureDbTables();
  const rows = await dbManager.all('SELECT guild_id, config_json FROM special_roles_config');
  const config = {};
  for (const row of rows) {
    try {
      config[row.guild_id] = JSON.parse(row.config_json);
    } catch (error) {
      console.error('❌ خطأ في قراءة إعدادات الرولات الخاصة من قاعدة البيانات:', error);
    }
  }
  return config;
}

async function persistRolesToDatabase() {
  const dbManager = getDatabase();
  if (!dbManager || !dbManager.isInitialized) return;
  await ensureDbTables();
  await dbManager.run('DELETE FROM special_roles');
  await dbManager.run('DELETE FROM special_roles_deleted');
  const roles = cache.roles?.roles || {};
  for (const entry of Object.values(roles)) {
    await dbManager.run(
      `INSERT INTO special_roles (role_id, guild_id, owner_id, created_at, created_by, name, color, icon, max_members)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.roleId, entry.guildId, entry.ownerId, entry.createdAt, entry.createdBy, entry.name, entry.color, entry.icon, entry.maxMembers]
    );
  }
  const deleted = cache.roles?.deleted || {};
  for (const entry of Object.values(deleted)) {
    await dbManager.run(
      `INSERT INTO special_roles_deleted (role_id, guild_id, owner_id, created_at, created_by, name, color, icon, max_members, deleted_at, deleted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.roleId,
        entry.guildId,
        entry.ownerId,
        entry.createdAt,
        entry.createdBy,
        entry.name,
        entry.color,
        entry.icon,
        entry.maxMembers,
        entry.deletedAt,
        entry.deletedBy
      ]
    );
  }
}

async function persistConfigToDatabase() {
  const dbManager = getDatabase();
  if (!dbManager || !dbManager.isInitialized) return;
  await ensureDbTables();
  const config = cache.config || {};
  for (const [guildId, data] of Object.entries(config)) {
    await dbManager.run(
      `INSERT INTO special_roles_config (guild_id, config_json)
       VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET config_json = excluded.config_json`,
      [guildId, JSON.stringify(data)]
    );
  }
}

async function initializeCustomRolesStorage() {
  const dbManager = getDatabase();
  if (!dbManager || !dbManager.isInitialized) return;
  await ensureDbTables();

  const dbRolesData = await loadRolesFromDatabase();
  const dbConfigData = await loadConfigFromDatabase();

  const hasDbRoles = dbRolesData && Object.keys(dbRolesData.roles || {}).length > 0;
  const hasDbConfig = dbConfigData && Object.keys(dbConfigData).length > 0;

  if (hasDbRoles) {
    cache.roles = dbRolesData;
  } else {
    cache.roles = loadJson(rolesPath, DEFAULT_ROLES_DATA);
    await persistRolesToDatabase();
  }

  if (hasDbConfig) {
    cache.config = dbConfigData;
  } else {
    cache.config = loadJson(configPath, DEFAULT_CONFIG_DATA);
    await persistConfigToDatabase();
  }

  if (!cache.roles.roles) cache.roles.roles = {};
  if (!cache.roles.deleted) cache.roles.deleted = {};
  cache.rolesIndexDirty = true;
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

function normalizeGuildConfig(config) {
  let updated = false;
  if (!Array.isArray(config.managerRoleIds)) {
    config.managerRoleIds = [];
    updated = true;
  }
  if (!Array.isArray(config.managerUserIds)) {
    config.managerUserIds = [];
    updated = true;
  }
  if (!Array.isArray(config.allowedChannels)) {
    config.allowedChannels = [];
    updated = true;
  }
  if (!Array.isArray(config.blockedChannels)) {
    config.blockedChannels = [];
    updated = true;
  }
  if (!config.roleActivityResetAt || typeof config.roleActivityResetAt !== 'object') {
    config.roleActivityResetAt = {};
    updated = true;
  }
  if (!config.requestCooldowns || typeof config.requestCooldowns !== 'object') {
    config.requestCooldowns = {};
    updated = true;
  }
  if (!config.pendingRoleRequests || typeof config.pendingRoleRequests !== 'object') {
    config.pendingRoleRequests = {};
    updated = true;
  }
  const nullableFields = [
    'logChannelId',
    'requestsChannelId',
    'requestInboxChannelId',
    'adminControlChannelId',
    'memberControlChannelId',
    'requestImage',
    'adminImage',
    'memberImage',
    'topChannelId',
    'topImage',
    'topMessageId',
    'activityResetAt'
  ];
  for (const field of nullableFields) {
    if (!(field in config)) {
      config[field] = null;
      updated = true;
    }
  }
  if (typeof config.topEnabled !== 'boolean') {
    config.topEnabled = false;
    updated = true;
  }
  return updated;
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
      allowedChannels: [],
      blockedChannels: [],
      requestCooldowns: {},
      pendingRoleRequests: {},
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
  } else if (normalizeGuildConfig(config[guildId])) {
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
  initializeCustomRolesStorage,
  rolesPath,
  configPath
};
