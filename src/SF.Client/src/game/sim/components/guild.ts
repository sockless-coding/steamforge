import { guildState } from '../guilds'
import { registerComponent } from './registry'

export interface GuildHallConfig {
  /** Standing target points for the guild it serves (see rules.guilds.weights.hall). */
  standing: number
}

/**
 * A guild's hall: the player chooses which guild meets there (`data.guild`). That guild's standing target rises
 * while the hall stands, and its strikers gather at the door.
 */
registerComponent<GuildHallConfig>({
  kind: 'guildHall',
  activate: (sim, b) => {
    if (typeof b.data.guild === 'string' && sim.content.guilds.has(b.data.guild)) return
    // The guild that stands lowest and has no hall yet.
    const taken = new Set([...sim.buildings.values()].filter((h) => h !== b && sim.def(h).components.guildHall).map((h) => h.data.guild))
    const open = (sim.content.bundle.guilds ?? []).filter((g) => !taken.has(g.id))
    const pick = (open.length ? open : sim.content.bundle.guilds ?? []).reduce<string | null>(
      (best, g) => (best === null || guildState(sim, g.id).standing < guildState(sim, best).standing ? g.id : best),
      null,
    )
    if (pick) b.data.guild = pick
  },
  option: (sim, b, _cfg, key, value) => {
    if (key !== 'guild' || !sim.content.guilds.has(value)) return false
    b.data.guild = value
    return true
  },
  describe: (sim, b) => {
    const guild = sim.content.guilds.get(b.data.guild as string)
    if (!guild) return ['Choose a guild to meet here']
    const s = guildState(sim, guild.id)
    return [`Hall of the ${guild.name}`, `Standing ${Math.round(s.standing)}${s.striking ? ': on strike' : ''}`]
  },
})
