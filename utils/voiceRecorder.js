const { execSync } = require('child_process');

function checkFFmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    console.error('❌ FFmpeg غير مثبت!');
    return false;
  }
}

const { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class VoiceRecorder {
  constructor() {
    this.recordings = new Map();
    this.connections = new Map();
    this.userActiveRecordings = new Map();
    this.recordingsDir = path.join(__dirname, '..', 'recordings');
    
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }

    setInterval(() => {
      this.cleanupOldRecordings();
    }, 60 * 60 * 1000);
  }

  cleanupOldRecordings() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    fs.readdir(this.recordingsDir, (err, files) => {
      if (err) return;
      
      files.forEach(file => {
        const filePath = path.join(this.recordingsDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          
          if (stats.mtimeMs < oneDayAgo) {
            fs.unlink(filePath, (err) => {
              if (!err) {
                console.log(`🧹 تم حذف الملف القديم: ${file}`);
              }
            });
          }
        });
      });
    });
  }

  cleanupRecordingFiles(recordingId) {
    try {
      const dir = this.recordingsDir;
      
      const files = fs.readdirSync(dir);
      
      files.forEach(file => {
        if (file.includes(recordingId)) {
          const fullPath = path.join(dir, file);
          try {
            fs.unlinkSync(fullPath);
            console.log(`🗑️ تم حذف الملف: ${file}`);
          } catch (err) {
            console.error(`خطأ في حذف ${file}:`, err);
          }
        }
      });

      console.log(`✅ تم تنظيف جميع ملفات التسجيل: ${recordingId}`);
      return true;
    } catch (error) {
      console.error('خطأ في تنظيف الملفات:', error);
      return false;
    }
  }

  isUserRecording(userId) {
    return this.userActiveRecordings.has(userId);
  }

  async startRecording(channel, userId) {
    if (this.isUserRecording(userId)) {
      throw new Error('المستخدم لديه تسجيل نشط بالفعل');
    }

    const recordingId = `${channel.id}_${userId}_${Date.now()}`;
    
    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      const outputPath = path.join(this.recordingsDir, `${recordingId}.pcm`);
      const finalOutputPath = path.join(this.recordingsDir, `${recordingId}.mp3`);

      const recordingData = {
        id: recordingId,
        userId,
        channelId: channel.id,
        channelName: channel.name,
        guildId: channel.guild.id,
        startTime: Date.now(),
        abuseTimes: [],
        outputPath: outputPath,
        finalOutputPath: finalOutputPath,
        pcmStreams: new Map(),
        connection: connection,
        receiver: null,
        isRecording: true
      };

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('انتهت مهلة الاتصال بالقناة الصوتية'));
        }, 10000);

        connection.on(VoiceConnectionStatus.Ready, () => {
          clearTimeout(timeout);
          console.log(`✅ تم الاتصال بالقناة الصوتية: ${channel.name}`);
          
          const receiver = connection.receiver;
          recordingData.receiver = receiver;

          receiver.speaking.on('start', (speakingUserId) => {
            if (!recordingData.isRecording) return;
            
            console.log(`🎤 بدأ ${speakingUserId} بالتحدث`);

            if (!recordingData.pcmStreams.has(speakingUserId)) {
              try {
                const audioStream = receiver.subscribe(speakingUserId, {
                  end: {
                    behavior: EndBehaviorType.Manual
                  }
                });

                const opusDecoder = new prism.opus.Decoder({
                  rate: 48000,
                  channels: 2,
                  frameSize: 960,
                  fec: true, // Forward Error Correction لتحسين جودة الصوت
                  plc: true  // Packet Loss Concealment للتعامل مع فقدان الحزم
                });

                const userPcmPath = path.join(this.recordingsDir, `${recordingId}_user_${speakingUserId}.pcm`);
                const fileStream = fs.createWriteStream(userPcmPath);

                audioStream.pipe(opusDecoder).pipe(fileStream);

                recordingData.pcmStreams.set(speakingUserId, {
                  path: userPcmPath,
                  stream: fileStream,
                  decoder: opusDecoder,
                  audioStream: audioStream
                });

                console.log(`💾 بدأ تسجيل صوت ${speakingUserId}`);
              } catch (error) {
                console.error(`خطأ في بدء تسجيل ${speakingUserId}:`, error);
              }
            }
          });

          resolve();
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
          clearTimeout(timeout);
          reject(new Error('تم قطع الاتصال بالقناة الصوتية'));
        });

        connection.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this.recordings.set(recordingId, recordingData);
      this.connections.set(channel.id, connection);
      this.userActiveRecordings.set(userId, recordingId);

      return recordingId;

    } catch (error) {
      this.cleanupRecordingFiles(recordingId);
      throw error;
    }
  }

  markAbuseTime(recordingId) {
    const recording = this.recordings.get(recordingId);
    if (!recording) return null;

    const abuseTime = Date.now() - recording.startTime;
    recording.abuseTimes.push(abuseTime);
    
    console.log(`⚠️ تم تسجيل وقت السب: ${abuseTime}ms من بداية التسجيل`);
    
    return abuseTime;
  }

  async stopRecording(recordingId) {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error('التسجيل غير موجود');
    }

    try {
      recording.isRecording = false;

      for (const [userId, streamData] of recording.pcmStreams.entries()) {
        try {
          if (streamData.audioStream) {
            streamData.audioStream.destroy();
          }
          if (streamData.decoder) {
            streamData.decoder.destroy();
          }
          if (streamData.stream) {
            streamData.stream.end();
          }
          console.log(`🛑 تم إيقاف تسجيل ${userId}`);
        } catch (error) {
          console.error(`خطأ في إيقاف تسجيل ${userId}:`, error);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1500));

      if (recording.connection) {
        recording.connection.destroy();
        this.connections.delete(recording.channelId);
      }

      const mergedFilePath = await this.mergePcmFiles(recordingId);
      
      this.recordings.delete(recordingId);
      this.userActiveRecordings.delete(recording.userId);

      return {
        filePath: mergedFilePath,
        duration: Date.now() - recording.startTime,
        abuseTimes: recording.abuseTimes,
        recordingId: recordingId
      };

    } catch (error) {
      this.recordings.delete(recordingId);
      this.userActiveRecordings.delete(recording.userId);
      this.cleanupRecordingFiles(recordingId);
      throw error;
    }
  }

  async mergePcmFiles(recordingId) {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error('التسجيل غير موجود');
    }

    if (recording.pcmStreams.size === 0) {
      throw new Error('لا توجد بيانات صوتية للدمج (لم يتحدث أحد)');
    }

    const outputMp3 = recording.finalOutputPath;
    const userFiles = [];

    for (const [userId, streamData] of recording.pcmStreams.entries()) {
      if (fs.existsSync(streamData.path)) {
        const stats = fs.statSync(streamData.path);
        if (stats.size > 1000) {
          userFiles.push(streamData.path);
        } else {
          console.log(`⚠️ ملف ${userId} صغير جداً (${stats.size} bytes), سيتم تجاهله`);
        }
      }
    }

    if (userFiles.length === 0) {
      this.cleanupRecordingFiles(recordingId);
      throw new Error('لا توجد ملفات صوتية صالحة للدمج');
    }

    await this.convertAndMergePcmToMp3(userFiles, outputMp3);

    for (const filePath of userFiles) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`خطأ في حذف الملف المؤقت ${filePath}:`, err);
      }
    }

    return outputMp3;
  }

  async convertAndMergePcmToMp3(pcmFiles, outputMp3) {
    if (!checkFFmpeg()) {
      throw new Error('FFmpeg غير مثبت على السيرفر');
    }

    return new Promise((resolve, reject) => {
      const filterInputs = pcmFiles.map((file, index) => 
        `-f s16le -ar 48000 -ac 2 -i "${file}"`
      ).join(' ');

      const filterComplex = pcmFiles.length > 1 
        ? `-filter_complex "amix=inputs=${pcmFiles.length}:duration=longest:dropout_transition=2,volume=2,highpass=f=80,lowpass=f=15000"` 
        : `-filter:a "volume=2,highpass=f=80,lowpass=f=15000"`;

      const ffmpegCommand = `ffmpeg ${filterInputs} ${filterComplex} -acodec libmp3lame -b:a 320k -ar 48000 -q:a 0 "${outputMp3}"`;

      console.log(`🔄 تحويل الملفات إلى MP3...`);

      const ffmpeg = spawn('sh', ['-c', ffmpegCommand]);
      let errorOutput = '';

      ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputMp3)) {
          const stats = fs.statSync(outputMp3);
          console.log(`✅ تم دمج وتحويل الملفات إلى: ${outputMp3} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
          resolve(outputMp3);
        } else {
          console.error(`❌ فشل FFmpeg: ${errorOutput}`);
          
          pcmFiles.forEach(file => {
            try {
              if (fs.existsSync(file)) fs.unlinkSync(file);
            } catch (err) {
              console.error(`خطأ في حذف ${file}:`, err);
            }
          });
          
          reject(new Error(`FFmpeg فشل بكود ${code}: ${errorOutput}`));
        }
      });

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('error', (error) => {
        console.error(`❌ خطأ في تشغيل FFmpeg:`, error);
        reject(error);
      });
    });
  }

  getRecording(recordingId) {
    return this.recordings.get(recordingId);
  }

  isRecording(channelId) {
    return this.connections.has(channelId);
  }

  cancelRecording(recordingId) {
    const recording = this.recordings.get(recordingId);
    if (!recording) return false;

    try {
      for (const [userId, streamData] of recording.pcmStreams.entries()) {
        try {
          if (streamData.audioStream) streamData.audioStream.destroy();
          if (streamData.decoder) streamData.decoder.destroy();
          if (streamData.stream) streamData.stream.end();
        } catch (error) {
          console.error(`خطأ في إلغاء تسجيل ${userId}:`, error);
        }
      }

      if (recording.connection) {
        recording.connection.destroy();
        this.connections.delete(recording.channelId);
      }

      this.recordings.delete(recordingId);
      this.userActiveRecordings.delete(recording.userId);
      this.cleanupRecordingFiles(recordingId);

      console.log(`✅ تم إلغاء التسجيل: ${recordingId}`);
      return true;
    } catch (error) {
      console.error('خطأ في إلغاء التسجيل:', error);
      return false;
    }
  }
}

module.exports = new VoiceRecorder();
