package com.audisay;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class AudisayBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(AudisayBackendApplication.class, args);
	}

}
