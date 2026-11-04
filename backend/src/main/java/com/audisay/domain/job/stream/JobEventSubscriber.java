package com.audisay.domain.job.stream;

import com.audisay.domain.job.dto.JobNotice;
import com.audisay.domain.job.service.JobProgressNotifier;
import com.audisay.domain.job.service.JobTimeEstimator;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;

/** job:events:* 를 서버마다 한 번 구독해 이 서버의 SSE 구독자에게 넘긴다 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JobEventSubscriber implements MessageListener {
    private final RedisMessageListenerContainer container;
    private final JobSseEmitters emitters;
    private final ObjectMapper objectMapper;
    private final JobTimeEstimator timeEstimator;

    @PostConstruct
    void subscribe() {
        container.addMessageListener(this, new PatternTopic(JobProgressNotifier.CHANNEL_PATTERN));
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel(), StandardCharsets.UTF_8);
        try {
            Long jobId = Long.valueOf(channel.substring(channel.lastIndexOf(':') + 1));
            JobNotice notice = objectMapper.readValue(message.getBody(), JobNotice.class);
            JobTimeEstimator.Estimate estimate = JobNotice.COMPLETED.equals(notice.event()) || JobNotice.FAILED.equals(notice.event())
                    ? JobTimeEstimator.Estimate.NONE
                    : timeEstimator.estimate(jobId, notice.progress());
            emitters.send(jobId, JobStreamEvent.from(notice, estimate));
        } catch (RuntimeException e) {
            log.warn("job 알림 처리 실패 channel={}: {}", channel, e.getMessage());
        }
    }
}
