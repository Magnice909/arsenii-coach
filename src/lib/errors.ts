/** Достаёт человекочитаемый текст ошибки из чего угодно — из настоящего Error,
 *  из объекта ошибки Supabase/PostgREST (он не всегда проходит `instanceof Error`,
 *  это зависит от точной версии @supabase/supabase-js, которая резолвится заново
 *  при каждой сборке, так как package-lock.json сознательно не коммитится) —
 *  и только если там вообще ничего не нашлось, отдаёт запасной текст. Раньше
 *  строгая проверка `instanceof Error` в некоторых сборках прятала реальную
 *  причину (например, нарушение ограничения в базе) за общей фразой вида
 *  «Не удалось создать план», по которой невозможно было понять, что сломалось. */
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
};
