import { request } from './client'
import type { Job } from './types'

export const jobsApi = {
  get: (jobId: number) => request<Job>({ url: `/jobs/${jobId}` }),
  streamPath: (jobId: number) => `/jobs/${jobId}/stream`,
}