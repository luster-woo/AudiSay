package com.audisay.global.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

@Configuration
public class RedisPubSubConfig {

    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer(RedisConnectionFactory connectionFactory) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.setTaskExecutor(listenerExecutor());
        return container;
    }

    /**
     * 기본(SimpleAsyncTaskExecutor)은 알림마다 스레드를 새로 만들고 같은 작업의 알림 순서가 바뀔 수 있어 스레드 하나로 차례대로.
     * Executor 빈으로 등록하면 Spring Boot 기본 applicationTaskExecutor가 빠지므로 빈으로 두지 않는다(데몬 스레드)
     */
    private static ThreadPoolTaskExecutor listenerExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(10_000);
        executor.setThreadNamePrefix("redis-job-events-");
        executor.setDaemon(true);
        // 큐가 차면 버리지 않고 Redis 수신 스레드에서 바로 처리한다
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}
