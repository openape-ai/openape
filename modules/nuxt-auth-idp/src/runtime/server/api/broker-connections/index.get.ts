import { defineEventHandler } from 'h3'
import { requireBrokerOwner } from '../../utils/broker-owner'
import { useBrokerStore } from '../../utils/broker-store'

export default defineEventHandler(async event => await useBrokerStore(event).listConnections(await requireBrokerOwner(event)))
