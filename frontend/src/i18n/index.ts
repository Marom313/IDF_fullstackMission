import ar from './ar'
import en from './en'
import he from './he'
import ru from './ru'

export const messages: Record<'he' | 'en' | 'ar' | 'ru', typeof en> = { he, en, ar, ru }
export type Locale = keyof typeof messages
export const locales = Object.keys(messages) as Locale[]
