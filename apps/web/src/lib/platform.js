/* The iOS merchant app serves existing accounts. Business registration and digital
   subscription purchases remain on the website, outside the iOS client. */
import { Capacitor } from '@capacitor/core'
import { NATIVE } from './api.js'

const IOS_APP = NATIVE && Capacitor.getPlatform() === 'ios'
export const PURCHASES_IN_APP = !IOS_APP
export const REGISTRATION_IN_APP = !IOS_APP
