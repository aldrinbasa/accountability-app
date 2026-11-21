import {
  ArrowFatUp,
  CalendarCheck,
  Camera,
  CheckCircle,
  Checks,
  Crown,
  Fire,
  FireSimple,
  Gavel,
  ListChecks,
  MoonStars,
  Seal,
  ShieldCheck,
  SunHorizon,
  Trophy,
  UsersThree,
} from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'

/** The catalog's `icon` names (Phosphor, kebab-case) as glyphs; badges-names-1.html. */
const BADGE_ICONS: Readonly<Record<string, PhosphorIcon>> = {
  camera: Camera,
  fire: Fire,
  'fire-simple': FireSimple,
  'shield-check': ShieldCheck,
  'check-circle': CheckCircle,
  checks: Checks,
  'calendar-check': CalendarCheck,
  'arrow-fat-up': ArrowFatUp,
  trophy: Trophy,
  crown: Crown,
  'users-three': UsersThree,
  gavel: Gavel,
  'sun-horizon': SunHorizon,
  'moon-stars': MoonStars,
  'list-checks': ListChecks,
}

/** The Weekly Winner badge's catalog icon (the Winner card's seal). */
export const WEEKLY_WINNER_ICON = 'trophy'

/** A catalog icon name as a glyph; an unknown name gets a plain seal. */
export function badgeIcon(name: string): PhosphorIcon {
  return BADGE_ICONS[name] ?? Seal
}
