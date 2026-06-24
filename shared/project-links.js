'use strict';

const PROJECT_LINK_KINDS = Object.freeze({
  OBSIDIAN: 'obsidian',
  GITHUB: 'github',
  URL: 'url',
  FILE: 'file'
});

function valuesOf(object) {
  return Object.keys(object).map((key) => object[key]);
}

function isProjectLinkKind(value) {
  return valuesOf(PROJECT_LINK_KINDS).includes(value);
}

function normalizeProjectLinkTarget(kind, target) {
  const normalized = String(target || '').trim();
  if (!normalized) return '';
  if (kind === PROJECT_LINK_KINDS.GITHUB || kind === PROJECT_LINK_KINDS.URL) {
    return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
  }
  return normalized;
}

function canOpenProjectLinkOnMobile(kind) {
  return kind !== PROJECT_LINK_KINDS.FILE;
}

function canOpenProjectLinkOnDesktop(kind) {
  return isProjectLinkKind(kind);
}

module.exports = {
  PROJECT_LINK_KINDS,
  canOpenProjectLinkOnDesktop,
  canOpenProjectLinkOnMobile,
  isProjectLinkKind,
  normalizeProjectLinkTarget
};
