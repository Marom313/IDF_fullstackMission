import groovy.json.JsonOutput
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import org.apache.nifi.processor.io.OutputStreamCallback

def source = session.get()
if (!source) return

def emit = { relationship, Map event, String name ->
    def output = session.create(source)
    output = session.putAttribute(output, 'filename', name)
    output = session.putAttribute(output, 'mime.type', 'application/json')
    output = session.write(output, { stream ->
        stream.write(JsonOutput.toJson(event).getBytes(StandardCharsets.UTF_8))
    } as OutputStreamCallback)
    session.transfer(output, relationship)
}

if (source.size > 65536) {
    emit(REL_FAILURE, [reason: 'FILE_TOO_LARGE'], "error-${source.id}.json")
    session.remove(source)
    return
}

byte[] bytes = session.read(source).withCloseable { stream -> stream.readAllBytes() }
String hash = HexFormat.of().formatHex(MessageDigest.getInstance('SHA-256').digest(bytes))
def lines = new String(bytes, StandardCharsets.UTF_8).readLines()
def rejects = { int number, String reason ->
    emit(REL_FAILURE, [fileHash: hash, line: number, reason: reason], "${hash}-${number}.json")
}

if (!lines || lines[0].replaceFirst(/^\uFEFF/, '').trim() != 'id,purpose,days') {
    rejects(1, 'INVALID_HEADER')
} else {
    Set seen = new HashSet()
    lines.drop(1).eachWithIndex { line, index ->
        int number = index + 2
        def fields = line.split(',', -1).collect { it.trim() }
        String id = fields[0].toLowerCase(Locale.ROOT)
        if (fields.size() != 3 || !(id ==~ /[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}/)) {
            rejects(number, 'INVALID_COLUMNS_OR_ID')
            return
        }
        String purpose = fields[1].toUpperCase(Locale.ROOT)
        if (!(purpose in ['DEMO_VISIT', 'DEMO_EVENT', 'DEMO_OTHER'])) {
            rejects(number, 'INVALID_PURPOSE')
            return
        }
        if (!(fields[2] ==~ /[0-9]{1,2}/) || fields[2].toInteger() < 1 || fields[2].toInteger() > 90) {
            rejects(number, 'INVALID_DAYS')
            return
        }
        if (!seen.add(id)) {
            rejects(number, 'DUPLICATE_ROW_ID')
            return
        }
        emit(REL_SUCCESS, [id: id, fileHash: hash, purpose: purpose, days: fields[2].toInteger()], "${id}.json")
    }
}
session.remove(source)
