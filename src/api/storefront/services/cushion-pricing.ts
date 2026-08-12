type CushionFabric = {
  patternRepeat_cm?: number
  patternRepeat?: number
  pattern_repeat_cm?: number
  pattern?: string | null
  patternName?: string | null
  pattern_type?: string | null
}

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isPlainFabric = (fabric: CushionFabric | null | undefined): boolean => {
  const pattern = String(fabric?.pattern ?? fabric?.patternName ?? fabric?.pattern_type ?? '').trim()
  const repeat = numberValue(fabric?.patternRepeat_cm ?? fabric?.patternRepeat ?? fabric?.pattern_repeat_cm)
  return repeat <= 0 || /plain/i.test(pattern)
}

const isPipedCushionFinish = (finishType: unknown): boolean => /piped/i.test(String(finishType ?? ''))

export function calculateCushionFabricMetres(
  fabric: CushionFabric | null | undefined,
  widthCm: number,
  heightCm: number,
  finishType?: unknown,
): number {
  const sizeCm = Math.max(numberValue(widthCm), numberValue(heightCm))
  const piped = isPipedCushionFinish(finishType)
  const requiredCm = piped ? Math.max(sizeCm + 10, 100) : sizeCm + 10
  const repeatCm = numberValue(fabric?.patternRepeat_cm ?? fabric?.patternRepeat ?? fabric?.pattern_repeat_cm)

  if (!isPlainFabric(fabric) && repeatCm > 0) {
    return Math.ceil(requiredCm / repeatCm) * repeatCm / 100
  }

  return Math.max(piped ? 1 : 0.5, requiredCm / 100)
}
