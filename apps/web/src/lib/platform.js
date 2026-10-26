/* Native apps never offer subscription purchases. The website retains billing;
   the existing iOS-only registration policy remains separate. */
import { Capacitor } from '@capacitor/core'
import { NATIVE } from './api.js'

const IOS_APP = NATIVE && Capacitor.getPlatform() === 'ios'
export const PURCHASES_IN_APP = !NATIVE
export const REGISTRATION_IN_APP = !IOS_APP
