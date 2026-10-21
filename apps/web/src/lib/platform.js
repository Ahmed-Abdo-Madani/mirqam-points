/* App Store Guideline 3.1.1: outside the US storefront an iOS app may not sell digital
   subscriptions (or point to where to buy them) except through In-App Purchase. Mirqam
   subscriptions are sold on the website only, so the iOS app shows no plans, prices,
   checkout or renewal calls to action — just the subscription status. */
import { Capacitor } from '@capacitor/core'
import { NATIVE } from './api.js'

export const PURCHASES_IN_APP = !(NATIVE && Capacitor.getPlatform() === 'ios')
