package com.audisay.domain.chat.answer;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 스트리밍 글자 조각을 문장으로 나눈다(AI split_sentences와 같은 규칙). 마침표·물음표·느낌표 뒤에 공백이 와야 문장 끝으로 본다
 * → "0.81초"처럼 숫자 사이 점은 나누지 않고, 조각 끝의 마침표는 다음 조각을 보고 정한다. 남은 글자는 {@link #flush}로
 */
public final class SentenceSplitter {
    private static final Pattern END = Pattern.compile("[.?!。…]+[\"'”’)]*(?=\\s)");

    private final StringBuilder buffer = new StringBuilder();

    public List<String> add(String delta) {
        buffer.append(delta);
        List<String> sentences = new ArrayList<>();
        Matcher matcher = END.matcher(buffer);
        int start = 0;
        while (matcher.find()) {
            String sentence = buffer.substring(start, matcher.end()).strip();
            if (!sentence.isEmpty()) {
                sentences.add(sentence);
            }
            start = matcher.end();
        }
        buffer.delete(0, start);
        return sentences;
    }

    public Optional<String> flush() {
        String rest = buffer.toString().strip();
        buffer.setLength(0);
        return rest.isEmpty() ? Optional.empty() : Optional.of(rest);
    }
}
