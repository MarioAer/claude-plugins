// Date formatting shared by the mod and its tests. The mods API adapter lives in mod.js because the
// plugin validator follows $ only into functions declared in the hooks module's own file.
export function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
