import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import 'dayjs/locale/fa'
import 'dayjs/locale/zh'
import 'dayjs/locale/fr'
import 'dayjs/locale/uz'
import 'dayjs/locale/de'
import 'dayjs/locale/hi'
import 'dayjs/locale/tr'
import 'dayjs/locale/az'
import 'dayjs/locale/es'
import 'dayjs/locale/vi'
import 'dayjs/locale/ja'
import 'dayjs/locale/be'
import 'dayjs/locale/uk'
import 'dayjs/locale/pt'
import 'dayjs/locale/pl'
import 'dayjs/locale/id'
import 'dayjs/locale/tk'
import 'dayjs/locale/th'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import duration from 'dayjs/plugin/duration'
import relativeTime from 'dayjs/plugin/relativeTime'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

export function initDayjs() {
    dayjs.extend(relativeTime)
    dayjs.extend(utc)
    dayjs.extend(duration)
    dayjs.extend(timezone)
    dayjs.extend(customParseFormat)
}
