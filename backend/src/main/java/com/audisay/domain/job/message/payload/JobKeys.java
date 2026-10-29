package com.audisay.domain.job.message.payload;

import com.audisay.domain.job.entity.Pipeline;

final class JobKeys {
    private JobKeys() {
    }

    static String transcript(Long jobId, Pipeline pipeline) {
        return pipeline == Pipeline.LOCAL ? "jobs/" + jobId + "/transcript.json" : null;
    }

    static String scenes(Long jobId, Pipeline pipeline) {
        return pipeline == Pipeline.LOCAL ? "jobs/" + jobId + "/scenes.json" : null;
    }
}
