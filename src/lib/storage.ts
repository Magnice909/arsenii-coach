export type Role = "coach" | "client";

export type User = {
  name: string;
  telegram: string;
  role: Role;
  email?: string;
  id?: string;
};

export type Client = {
  id: string;
  userId?: string;
  coachId?: string;
  name: string;
  telegram: string;
  email: string;
  goal: string;
  plan: string;
  status: string;
  progress: number;
  nextWorkout: string;
  comment: string;
  nutrition: string;
  assignedWorkoutId: string;
  weeklyPlan: Record<string, string>;
};

export type Workout = {
  id: string;
  title: string;
  day: string;
  focus: string;
  notes: string;
  exercises: string[];
};

export type Message = {
  id: string;
  from: string;
  text: string;
  time: string;
};

export type SiteSettings = {
  brand: string;
  heroBadge: string;
  heroTitle: string;
  heroSubtitle: string;
  ctaText: string;
  quote: string;
  approachTitle: string;
  approachText1: string;
  approachText2: string;
  photoDataUrl: string;
};

const defaultClients: Client[] = [];
const defaultWorkouts: Workout[] = [];
const defaultMessages: Message[] = [];

const defaultSiteSettings: SiteSettings = {
  brand: "ARSENIICOACH",
  heroBadge: "Сейчас открыт набор на 1:1 сопровождение",
  heroTitle: "1:1 онлайн фитнес-коучинг",
  heroSubtitle: "Персональное онлайн-сопровождение от Арсения: тренировки, питание, контроль прогресса и структура, которая помогает стабильно двигаться к форме.",
  ctaText: "Оставить заявку",
  quote: "Комфорт — враг формы, к которой ты стремишься.",
  approachTitle: "Почему онлайн-сопровождение?",
  approachText1: "Большинство людей буксует не из-за отсутствия дисциплины, а из-за отсутствия структуры. Случайные тренировки, непонятное питание и короткие всплески мотивации не дают стабильного результата.",
  approachText2: "1:1 сопровождение убирает хаос: план под ваш график, понятные цели, регулярная обратная связь и контроль выполнения.",
  photoDataUrl: "",
};

export const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const getUser = (): User | null => {
  try { return JSON.parse(localStorage.getItem("arseniiCoachUser") || "null"); } catch { return null; }
};
export const setUser = (user: User) => localStorage.setItem("arseniiCoachUser", JSON.stringify(user));
export const logout = () => localStorage.removeItem("arseniiCoachUser");

export const getClients = (): Client[] => JSON.parse(localStorage.getItem("arseniiCoachClients") || JSON.stringify(defaultClients));
export const setClients = (clients: Client[]) => localStorage.setItem("arseniiCoachClients", JSON.stringify(clients));
export const getWorkouts = (): Workout[] => JSON.parse(localStorage.getItem("arseniiCoachWorkouts") || JSON.stringify(defaultWorkouts));
export const setWorkouts = (workouts: Workout[]) => localStorage.setItem("arseniiCoachWorkouts", JSON.stringify(workouts));
export const getMessages = (): Message[] => JSON.parse(localStorage.getItem("arseniiCoachMessages") || JSON.stringify(defaultMessages));
export const setMessages = (messages: Message[]) => localStorage.setItem("arseniiCoachMessages", JSON.stringify(messages));

export const getSiteSettings = (): SiteSettings => {
  try { return { ...defaultSiteSettings, ...JSON.parse(localStorage.getItem("arseniiCoachSiteSettings") || "{}") }; } catch { return defaultSiteSettings; }
};
export const setSiteSettings = (settings: SiteSettings) => localStorage.setItem("arseniiCoachSiteSettings", JSON.stringify(settings));
export const resetSiteSettings = () => localStorage.removeItem("arseniiCoachSiteSettings");
