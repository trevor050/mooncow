// Built-in tools. Both halves of MoonCow live here: getting you to things
// (tabs, closed tabs, history, bookmarks, commands, the web) and answering in
// place (calculator, converters, color, hashes, dates, definitions, AI).
// Registration order only breaks exact score ties.
import type { Tool } from '@/core/types';
import ai from './ai';
import algebra from './algebra';
import appSearch from './app-search';
import browserCommands from './browser-commands';
import calculator from './calculator';
import color from './color';
import converter from './converter';
import datetime from './datetime';
import developer from './developer';
import dice from './dice';
import dictionary from './dictionary';
import encoders from './encoders';
import generators from './generators';
import history from './history';
import misc from './misc';
import palette from './palette-commands';
import recentlyClosed from './recently-closed';
import tabs from './tabs';
import time from './time';
import weather from './weather';
import web from './web';

export const BUILTIN_TOOLS: Tool[] = [
  tabs,
  recentlyClosed,
  history,
  browserCommands,
  web,
  appSearch,
  calculator,
  algebra,
  converter,
  color,
  time,
  datetime,
  dictionary,
  weather,
  encoders,
  developer,
  generators,
  dice,
  misc,
  palette,
  ai,
];
